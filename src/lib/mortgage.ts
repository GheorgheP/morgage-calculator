// Mortgage / annuity loan math.
//
// Conventions:
//   - annualRate is a percentage (e.g. 5.5 means 5.5% APR)
//   - termYears is the contract term in years
//   - monthly compounding: r = annualRate / 100 / 12
//   - prepayments ("covers") apply to principal AFTER the regular installment
//     for that month is recorded. The bank deducts a commission from the cover
//     amount, so effective principal reduction = cover * (1 - commissionRate).
//   - Two prepayment behaviors:
//       "shorten": keep the monthly payment fixed; the loan is paid off earlier.
//       "lower":   keep the original term; recompute the monthly payment over
//                  the months remaining whenever a cover is applied.

export type PrepaymentMode = "shorten" | "lower"

export interface LoanInputs {
  /** Loan amount in currency units. */
  amount: number
  /** Nominal annual interest rate as a percent (e.g. 5.5). */
  annualRate: number
  /** Loan term in years. */
  termYears: number
}

export interface AmortizationRow {
  month: number
  /** Scheduled installment for this month (interest + principal). */
  payment: number
  interest: number
  /** Principal portion of the regular installment. */
  principal: number
  /**
   * Prepayment applied this month (gross, before commission). Capped at what
   * it takes to clear the remaining balance, so it can be less than entered.
   */
  cover: number
  /** Bank commission deducted from the cover amount. */
  commission: number
  /** Amount of the cover that actually reduced principal (cover - commission). */
  effectivePrincipalReduction: number
  /** Total cash out the door this month (installment + cover). */
  totalOutOfPocket: number
  /** Outstanding loan balance after this month's installment AND cover. */
  balance: number
}

export interface ScheduleResult {
  rows: AmortizationRow[]
  /** Initial annuity installment based on full term, no prepayments. */
  baseMonthlyPayment: number
  /** Sum of all scheduled installments (including reduced installments in "lower" mode). */
  totalPaid: number
  /** Sum of all interest paid. */
  totalInterest: number
  /** Sum of all principal paid via installments. */
  totalPrincipalFromInstallments: number
  /** Sum of all gross prepayment amounts (covers). */
  totalCovers: number
  /** Sum of all bank commissions on prepayments. */
  totalCommissions: number
  /** Sum of installments + covers (everything that left the borrower's pocket). */
  totalOutOfPocket: number
  /** Number of months the loan actually ran (for "shorten" this can be < term). */
  monthsActual: number
  /** Original term length in months (termYears * 12). */
  monthsOriginal: number
}

const EPSILON = 0.005 // half a cent — finer than any displayable rounding

export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number
): number {
  if (termMonths <= 0) return 0
  const r = annualRate / 100 / 12
  if (r === 0) return principal / termMonths
  const factor = Math.pow(1 + r, termMonths)
  return (principal * r * factor) / (factor - 1)
}

export function generateSchedule(
  inputs: LoanInputs,
  manualCovers: Record<number, number>,
  auto: AutoCoverConfig,
  mode: PrepaymentMode,
  commissionRate: number = 0.01
): ScheduleResult {
  const { amount, annualRate, termYears } = inputs
  const monthsOriginal = Math.round(termYears * 12)
  const r = annualRate / 100 / 12

  const baseMonthlyPayment = calculateMonthlyPayment(
    amount,
    annualRate,
    monthsOriginal
  )

  const rows: AmortizationRow[] = []

  if (amount <= 0 || monthsOriginal <= 0) {
    return {
      rows,
      baseMonthlyPayment,
      totalPaid: 0,
      totalInterest: 0,
      totalPrincipalFromInstallments: 0,
      totalCovers: 0,
      totalCommissions: 0,
      totalOutOfPocket: 0,
      monthsActual: 0,
      monthsOriginal,
    }
  }

  let balance = amount
  let payment = baseMonthlyPayment
  let totalPaid = 0
  let totalInterest = 0
  let totalPrincipalFromInstallments = 0
  let totalCovers = 0
  let totalCommissions = 0
  let totalOutOfPocket = 0

  const autoActive = auto.amount > 0 && auto.every > 0
  const topUpActive = autoActive && !!auto.topUpFromPayment && mode === "lower"
  // Installment savings (base - current installment) accumulated since the
  // last auto cover that recycled them.
  let pendingSavings = 0

  // Safety cap: in pathological inputs the loop could otherwise run forever.
  const safetyMax = monthsOriginal + 1200

  for (let month = 1; month <= safetyMax && balance > EPSILON; month++) {
    const interest = balance * r
    let principalPart = payment - interest
    let actualPayment = payment

    // Final installment: pay exactly the remaining balance, no more.
    if (principalPart >= balance) {
      principalPart = balance
      actualPayment = principalPart + interest
    }

    balance -= principalPart

    if (topUpActive) pendingSavings += Math.max(0, baseMonthlyPayment - payment)

    // Resolve the cover for this month. Manual entry (including 0 = skip)
    // always wins; otherwise the auto schedule fires on its period. When
    // top-up is active, the auto cover also recycles every month's savings
    // from the reduced installment since the last auto cover. Savings from a
    // month whose auto cover was overridden or skipped carry over to the next.
    let coverAmount = 0
    if (Object.prototype.hasOwnProperty.call(manualCovers, month)) {
      coverAmount = Math.max(0, manualCovers[month] || 0)
    } else if (autoActive && month % auto.every === 0) {
      coverAmount = auto.amount
      if (topUpActive && pendingSavings > 0) {
        coverAmount += Math.ceil(pendingSavings)
        pendingSavings = 0
      }
    }
    // Never take more cash than it costs to clear the loan: cap the gross
    // cover at balance / (1 - commissionRate) so the net reduction equals the
    // remaining balance. Nothing is left to prepay once the balance is gone.
    if (balance <= EPSILON) {
      coverAmount = 0
    } else if (commissionRate < 1) {
      coverAmount = Math.min(coverAmount, balance / (1 - commissionRate))
    }
    const commission = coverAmount * commissionRate
    const grossEffectiveReduction = coverAmount - commission
    let effectiveReduction = 0

    if (grossEffectiveReduction > 0) {
      effectiveReduction = Math.min(grossEffectiveReduction, balance)
      balance -= effectiveReduction

      // In "lower" mode, recompute the installment over the months that
      // remain in the original term. In "shorten" mode, leave payment
      // alone — the loan will simply terminate earlier.
      if (mode === "lower" && balance > EPSILON) {
        const monthsLeft = monthsOriginal - month
        if (monthsLeft > 0) {
          payment = calculateMonthlyPayment(balance, annualRate, monthsLeft)
        }
      }
    }

    if (balance < EPSILON) balance = 0

    rows.push({
      month,
      payment: actualPayment,
      interest,
      principal: principalPart,
      cover: coverAmount,
      commission,
      effectivePrincipalReduction: effectiveReduction,
      totalOutOfPocket: actualPayment + coverAmount,
      balance,
    })

    totalPaid += actualPayment
    totalInterest += interest
    totalPrincipalFromInstallments += principalPart
    totalCovers += coverAmount
    totalCommissions += commission
    totalOutOfPocket += actualPayment + coverAmount
  }

  return {
    rows,
    baseMonthlyPayment,
    totalPaid,
    totalInterest,
    totalPrincipalFromInstallments,
    totalCovers,
    totalCommissions,
    totalOutOfPocket,
    monthsActual: rows.length,
    monthsOriginal,
  }
}

/**
 * Net saving of `result` versus the same loan without prepayments: interest
 * avoided minus the commissions paid to get there. Can be negative when the
 * commissions outweigh the interest saved.
 *
 * Do NOT compare installment totals (`totalPaid`): installments also shrink
 * because principal was repaid through covers, which is not a saving.
 */
export function netPrepaymentSaving(
  baseline: ScheduleResult,
  result: ScheduleResult
): number {
  return baseline.totalInterest - result.totalInterest - result.totalCommissions
}

export function formatCurrency(
  value: number,
  currency: string = "EUR",
  locale: string = "en-US"
): string {
  if (!Number.isFinite(value)) return "—"
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

export function formatNumber(value: number, locale: string = "en-US"): string {
  if (!Number.isFinite(value)) return "—"
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)
}

/**
 * Add `n` calendar months to a date, capping the day at the resulting month's
 * last day so e.g. (Jan 31 + 1 month) returns Feb 28/29 instead of overflowing.
 */
export function addMonths(date: Date, n: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), 1)
  const day = date.getDate()
  result.setMonth(result.getMonth() + n)
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate()
  result.setDate(Math.min(day, lastDay))
  return result
}

/** Parse a YYYY-MM-DD string (from <input type="date">) into a local Date. */
export function parseISODate(s: string): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || !mo || !d) return null
  return new Date(y, mo - 1, d)
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
})

export function formatDate(date: Date | null): string {
  if (!date) return "—"
  return dateFmt.format(date)
}

export interface AutoCoverConfig {
  /** Recurring prepayment amount. <= 0 disables. */
  amount: number
  /** Period in months (e.g. 12 = annually). <= 0 disables. */
  every: number
  /**
   * When true AND mode is "lower", each auto cover is increased by the sum
   * of (basePayment - currentPayment) over every month since the previous
   * auto cover — recycling the savings from a reduced installment back into
   * principal.
   */
  topUpFromPayment?: boolean
}

export type DownPaymentUnit = "amount" | "percent"

export interface DownPayment {
  /** Down payment in currency units, clamped to [0, price]. */
  amount: number
  /** Down payment as a percent of the price, clamped to [0, 100]. */
  percent: number
  /** What has to be borrowed: price - down payment. */
  loan: number
  /** True when the entered value exceeded the price (or 100%) and was capped. */
  capped: boolean
}

/**
 * Resolve a down payment entered either as an amount or as a percent of the
 * property price into both forms, plus the resulting loan amount.
 */
export function resolveDownPayment(
  price: number,
  value: number,
  unit: DownPaymentUnit
): DownPayment {
  const p = Math.max(0, price)
  const v = Math.max(0, value)
  if (unit === "percent") {
    const percent = Math.min(v, 100)
    const amount = (p * percent) / 100
    return { amount, percent, loan: p - amount, capped: v > 100 }
  }
  const amount = Math.min(v, p)
  const percent = p > 0 ? (amount / p) * 100 : 0
  return { amount, percent, loan: p - amount, capped: v > p }
}
