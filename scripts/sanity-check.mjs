// Sanity tests for the mortgage schedule generator.
// Runs via:   node scripts/sanity-check.mjs
// (Reads ../src/lib/mortgage.ts using node's --experimental-strip-types loader.)

import {
  generateSchedule,
  calculateMonthlyPayment,
  addMonths,
  parseISODate,
  netPrepaymentSaving,
  resolveDownPayment,
} from "../src/lib/mortgage.ts"
import { parseAmount, parseDecimal, sanitizeNumericInput } from "../src/lib/number.ts"
import {
  parsePersisted,
  serializePersisted,
} from "../src/lib/persistence.ts"

const NO_AUTO = { amount: 0, every: 0 }
const LOAN = { amount: 100000, annualRate: 5.5, termYears: 25 }

let failures = 0
function check(ok, label) {
  if (!ok) {
    failures++
    console.error(`FAIL ${label}`)
  } else {
    console.log(`ok   ${label}`)
  }
}
function approx(a, b, eps = 0.5, label = "") {
  const ok = Math.abs(a - b) <= eps
  if (!ok) {
    failures++
    console.error(`FAIL ${label}: got ${a}, expected ${b} (±${eps})`)
  } else {
    console.log(`ok   ${label}: ${a.toFixed(2)} ≈ ${b.toFixed(2)}`)
  }
}

// --- Test 1: standard 100k @ 5.5% over 25y, no prepayments ---
// Expected monthly via the formula: 614.09 (well-known from any mortgage calc).
{
  const m = calculateMonthlyPayment(100000, 5.5, 300)
  approx(m, 614.09, 0.5, "100k/5.5%/25y monthly payment")

  const r = generateSchedule({ amount: 100000, annualRate: 5.5, termYears: 25 }, {}, NO_AUTO, "shorten")
  approx(r.monthsActual, 300, 0, "schedule length")
  approx(r.rows[r.rows.length - 1].balance, 0, 0.01, "final balance is zero")
  // Total interest over 25y on 100k @ 5.5% should be ≈ 84,226 (= 614.09 * 300 - 100000)
  approx(r.totalInterest, 614.09 * 300 - 100000, 5, "total interest matches payment*n - principal")
}

// --- Test 2: zero interest rate ---
{
  const r = generateSchedule({ amount: 12000, annualRate: 0, termYears: 1 }, {}, NO_AUTO, "shorten")
  approx(r.baseMonthlyPayment, 1000, 0.001, "0% rate => principal/n")
  approx(r.totalInterest, 0, 0.001, "0% rate => zero total interest")
  approx(r.monthsActual, 12, 0, "0% rate => exact term")
}

// --- Test 3: prepayment in shorten mode reduces months and total interest ---
{
  const baseline = generateSchedule({ amount: 100000, annualRate: 5.5, termYears: 25 }, {}, NO_AUTO, "shorten")
  const withCover = generateSchedule(
    { amount: 100000, annualRate: 5.5, termYears: 25 },
    { 1: 10000 }, // pay 10k in month 1; 1% commission => 9900 reduces principal
    NO_AUTO,
    "shorten",
    0.01
  )
  if (withCover.monthsActual >= baseline.monthsActual) {
    failures++
    console.error("FAIL prepay shortens schedule")
  } else {
    console.log(`ok   shorten: ${baseline.monthsActual}mo -> ${withCover.monthsActual}mo`)
  }
  if (withCover.totalInterest >= baseline.totalInterest) {
    failures++
    console.error("FAIL prepay reduces total interest")
  } else {
    console.log(`ok   interest reduced: ${baseline.totalInterest.toFixed(2)} -> ${withCover.totalInterest.toFixed(2)}`)
  }
  // commission on 10k @ 1% must equal 100
  approx(withCover.totalCommissions, 100, 0.001, "commission on 10k cover")
}

// --- Test 4: prepayment in lower mode keeps the term, reduces installment ---
{
  const baseline = generateSchedule({ amount: 100000, annualRate: 5.5, termYears: 25 }, {}, NO_AUTO, "lower")
  const withCover = generateSchedule(
    { amount: 100000, annualRate: 5.5, termYears: 25 },
    { 1: 10000 }, NO_AUTO, "lower",
    0.01
  )
  approx(withCover.monthsActual, baseline.monthsActual, 0, "lower mode keeps term")
  if (withCover.rows[12].payment >= baseline.rows[12].payment) {
    failures++
    console.error("FAIL lower mode reduces installment after prepay")
  } else {
    console.log(`ok   installment lowered after prepay: ${baseline.rows[12].payment.toFixed(2)} -> ${withCover.rows[12].payment.toFixed(2)}`)
  }
  // Final balance should still be ≈ 0
  approx(withCover.rows[withCover.rows.length - 1].balance, 0, 0.01, "lower mode pays off")
}

// --- Test 5: invariant per row -- payment = interest + principal  (within 1c) ---
{
  const r = generateSchedule({ amount: 250000, annualRate: 4.25, termYears: 30 }, { 24: 5000, 60: 7500 }, NO_AUTO, "shorten")
  for (const row of r.rows) {
    if (Math.abs(row.payment - (row.interest + row.principal)) > 0.011) {
      failures++
      console.error(`FAIL invariant month ${row.month}: ${row.payment} vs ${row.interest + row.principal}`)
      break
    }
  }
  console.log(`ok   payment = interest + principal across all ${r.rows.length} rows`)
  // commission totals: 5000*0.01 + 7500*0.01 = 125
  approx(r.totalCommissions, 125, 0.001, "two-cover commission total")
}

// --- Test 6: addMonths handles end-of-month overflow correctly ---
{
  const jan31 = new Date(2026, 0, 31)
  const feb = addMonths(jan31, 1)
  if (feb.getMonth() !== 1 || feb.getDate() !== 28) {
    failures++
    console.error(`FAIL Jan 31 + 1mo => ${feb.toDateString()} (expected Feb 28)`)
  } else {
    console.log(`ok   Jan 31 + 1mo = Feb 28 (no overflow)`)
  }

  // Leap year: Jan 31, 2028 + 1 month should be Feb 29.
  const jan31Leap = new Date(2028, 0, 31)
  const febLeap = addMonths(jan31Leap, 1)
  if (febLeap.getMonth() !== 1 || febLeap.getDate() !== 29) {
    failures++
    console.error(`FAIL Jan 31, 2028 + 1mo => ${febLeap.toDateString()}`)
  } else {
    console.log(`ok   Jan 31, 2028 + 1mo = Feb 29 (leap year)`)
  }

  // 360 months from a fixed date.
  const start = new Date(2026, 3, 26) // Apr 26 2026
  const end = addMonths(start, 360)
  if (end.getFullYear() !== 2056 || end.getMonth() !== 3 || end.getDate() !== 26) {
    failures++
    console.error(`FAIL +360 months from Apr 26 2026 => ${end.toDateString()}`)
  } else {
    console.log(`ok   +360 months from Apr 26 2026 = Apr 26 2056`)
  }
}

// --- Test 7: parseISODate ---
{
  const d = parseISODate("2026-04-26")
  if (!d || d.getFullYear() !== 2026 || d.getMonth() !== 3 || d.getDate() !== 26) {
    failures++
    console.error(`FAIL parseISODate("2026-04-26")`)
  } else {
    console.log(`ok   parseISODate("2026-04-26") -> Apr 26 2026`)
  }
  if (parseISODate("") !== null || parseISODate("garbage") !== null) {
    failures++
    console.error(`FAIL parseISODate empty/invalid should be null`)
  } else {
    console.log(`ok   parseISODate empty/invalid -> null`)
  }
}

// --- Test 8: auto cover fires on multiples of `every` only ---
{
  const r = generateSchedule(LOAN, {}, { amount: 1000, every: 12 }, "shorten", 0.01)
  const fired = r.rows.filter((x) => x.cover > 0).map((x) => x.month).slice(0, 3)
  check(JSON.stringify(fired) === "[12,24,36]", `auto fires on 12, 24, 36 (got ${fired})`)
  check(r.rows[11].cover === 1000, "auto amount = 1000")
}

// --- Test 9: manual overrides auto; manual 0 skips ---
{
  const r = generateSchedule(
    LOAN,
    { 12: 5000, 24: 0 },
    { amount: 1000, every: 12 },
    "shorten",
    0.01
  )
  check(r.rows[11].cover === 5000, "manual 5000 wins over auto at month 12")
  check(r.rows[23].cover === 0, "manual 0 skips the auto cover at month 24")
  check(r.rows[35].cover === 1000 && r.rows[47].cover === 1000, "auto continues at months 36 and 48")
}

// --- Test 10: disabled auto ---
{
  const a = generateSchedule(LOAN, { 6: 500 }, { amount: 0, every: 12 }, "shorten", 0.01)
  const b = generateSchedule(LOAN, { 6: 500 }, { amount: 1000, every: 0 }, "shorten", 0.01)
  check(a.totalCovers === 500, "amount=0 disables auto, manual still works")
  check(b.totalCovers === 500, "every=0 disables auto, manual still works")
}

// --- Test 11: end-to-end — auto cover shortens the loan, commission is 1% ---
{
  const r = generateSchedule(LOAN, {}, { amount: 5000, every: 12 }, "shorten", 0.01)
  check(r.monthsActual < 300, `recurring 5000/12mo shortens 300mo loan to ${r.monthsActual}mo`)
  check(Math.abs(r.totalCommissions / r.totalCovers - 0.01) < 1e-9, "commissions are exactly 1% of total covers")
}

// --- Test 11b (regression): top-up recycles ALL savings since last auto cover ---
// Previously only one month's (base - current) was added, even though the
// reduced installment saved that amount every month of the period.
{
  const auto = { amount: 5000, every: 12, topUpFromPayment: true }
  const r = generateSchedule(LOAN, {}, auto, "lower", 0.01)
  const saved = (from, to) =>
    r.rows.slice(from - 1, to).reduce((s, x) => s + (r.baseMonthlyPayment - x.payment), 0)
  check(r.rows[11].cover === 5000, "month 12: nothing saved yet, cover = 5000")
  const expected24 = 5000 + Math.ceil(saved(13, 24))
  check(r.rows[23].cover === expected24, `month 24: top-up = 12 months of savings (${r.rows[23].cover} = ${expected24})`)
  check(r.rows[23].cover - 5000 > 300, `month 24 top-up is ~12x one month (${r.rows[23].cover - 5000})`)
  const expected36 = 5000 + Math.ceil(saved(25, 36))
  check(r.rows[35].cover === expected36, `month 36: counter resets after each auto cover (${r.rows[35].cover} = ${expected36})`)

  // A skipped auto month carries its savings into the next auto cover.
  const skip = generateSchedule(LOAN, { 24: 0 }, auto, "lower", 0.01)
  const saved2 = (from, to) =>
    skip.rows.slice(from - 1, to).reduce((s, x) => s + (skip.baseMonthlyPayment - x.payment), 0)
  const expectedSkip = 5000 + Math.ceil(saved2(13, 36))
  check(skip.rows[35].cover === expectedSkip, `skipped month 24 carries savings to 36 (${skip.rows[35].cover} = ${expectedSkip})`)

  // Top-up never applies in shorten mode.
  const sh = generateSchedule(LOAN, {}, auto, "shorten", 0.01)
  check(sh.rows.filter((x) => x.cover > 0).every((x) => x.cover === 5000 || x.month === sh.monthsActual), "shorten mode: no top-up")
}

// --- Test 11c (regression): savings = interest avoided - commissions ---
// Comparing installment totals counted the prepaid principal as "saved".
{
  const baseline = generateSchedule(LOAN, {}, NO_AUTO, "shorten", 0.01)
  const r = generateSchedule(LOAN, { 1: 10000 }, NO_AUTO, "shorten", 0.01)
  const saving = netPrepaymentSaving(baseline, r)
  approx(
    saving,
    baseline.totalInterest - r.totalInterest - 100,
    0.001,
    "net saving = interest avoided - commission"
  )
  // The buggy formula (installment totals) overstates by ~ the prepaid principal.
  const buggy = baseline.totalPaid - r.totalPaid
  check(buggy - saving > 9000, `saving excludes prepaid principal (${saving.toFixed(2)} vs old ${buggy.toFixed(2)})`)
  // Net of commission: holds for every cover, whatever the loan.
  for (const mode of ["shorten", "lower"]) {
    const b = generateSchedule(LOAN, {}, NO_AUTO, mode, 0.01)
    const x = generateSchedule(LOAN, {}, { amount: 5000, every: 12 }, mode, 0.01)
    approx(
      netPrepaymentSaving(b, x),
      b.totalInterest - x.totalInterest - x.totalCommissions,
      0.001,
      `${mode}: saving is net of commissions`
    )
  }
}

// --- Test 11d (regression): cover larger than balance is capped ---
// Previously the full cover + commission was charged while only the remaining
// balance was reduced, so the surplus vanished from "Out of pocket".
{
  const noLost = (r) =>
    r.rows.every((x) => Math.abs(x.cover - x.commission - x.effectivePrincipalReduction) < 1e-6)

  // Manual cover near the end.
  const r = generateSchedule(LOAN, { 299: 5000 }, NO_AUTO, "shorten", 0.01)
  const row = r.rows[298]
  check(r.monthsActual === 299, "oversized cover at month 299 ends the loan there")
  approx(row.balance, 0, 0.001, "balance cleared")
  approx(row.cover, row.effectivePrincipalReduction / 0.99, 0.001, "cover capped at balance / (1 - commission)")
  approx(row.commission, row.cover * 0.01, 0.001, "commission charged only on the capped cover")
  check(row.cover < 1000, `capped cover ${row.cover.toFixed(2)} << entered 5000`)

  // Cover on the final installment month: nothing left to prepay.
  const f = generateSchedule(LOAN, { 300: 1000 }, NO_AUTO, "shorten", 0.01).rows[299]
  check(f.cover === 0 && f.commission === 0, "cover on final month is not charged")
  approx(f.totalOutOfPocket, f.payment, 0.001, "final month out of pocket = installment only")

  // Auto cover overshooting at the end, both modes.
  for (const mode of ["shorten", "lower"]) {
    const a = generateSchedule(LOAN, {}, { amount: 5000, every: 12 }, mode, 0.01)
    check(noLost(a), `${mode}: every cover euro is either commission or principal`)
    approx(
      a.totalOutOfPocket,
      LOAN.amount + a.totalInterest + a.totalCommissions,
      0.01,
      `${mode}: out of pocket = principal + interest + commissions`
    )
  }

  // Zero commission: cover capped exactly at the balance.
  const z = generateSchedule(LOAN, { 299: 5000 }, NO_AUTO, "shorten", 0)
  approx(z.rows[298].cover, z.rows[298].effectivePrincipalReduction, 0.001, "0% commission: cover = balance")
}

// --- Test 11e (regression): number parsing with thousands separators ---
// Previously every "," became a decimal point: "100,000" was read as 100.
{
  const amounts = [
    ["100000", 100000],
    ["100,000", 100000],
    ["100.000", 100000],
    ["1,000,000", 1000000],
    ["1.000.000", 1000000],
    ["250,000.50", 250000.5],
    ["250.000,50", 250000.5],
    ["150 000", 150000],
    ["1'500'000", 1500000],
    ["€ 1,500", 1500],
    ["1500.5", 1500.5],
    ["1500,5", 1500.5],
    ["1234,56", 1234.56],
    ["0,500", 0.5],
    ["5,", 5],
    ["5.", 5],
    ["", 0],
    ["abc", 0],
  ]
  for (const [raw, expected] of amounts) {
    approx(parseAmount(raw), expected, 1e-9, `parseAmount(${JSON.stringify(raw)})`)
  }
  const rates = [
    ["5.5", 5.5],
    ["5,5", 5.5],
    ["4,250", 4.25],
    ["4.250", 4.25],
    ["0,75", 0.75],
    ["1.2.3", 1.23],
  ]
  for (const [raw, expected] of rates) {
    approx(parseDecimal(raw), expected, 1e-9, `parseDecimal(${JSON.stringify(raw)})`)
  }
  check(sanitizeNumericInput("€100,000.50 EUR") === "100,000.50 ", "sanitize keeps digits and separators")
}

// --- Test 11f: down payment as amount or percent of price ---
{
  const pct = resolveDownPayment(200000, 20, "percent")
  approx(pct.amount, 40000, 1e-9, "20% of 200k = 40k")
  approx(pct.loan, 160000, 1e-9, "loan = price - down payment (percent)")
  check(!pct.capped, "20% is not capped")

  const amt = resolveDownPayment(200000, 50000, "amount")
  approx(amt.percent, 25, 1e-9, "50k of 200k = 25%")
  approx(amt.loan, 150000, 1e-9, "loan = price - down payment (amount)")

  // Round trip: amount -> percent -> amount gives the same down payment.
  const back = resolveDownPayment(200000, amt.percent, "percent")
  approx(back.amount, 50000, 1e-9, "amount -> percent -> amount round trip")

  const over = resolveDownPayment(200000, 250000, "amount")
  check(over.capped && over.amount === 200000 && over.loan === 0, "amount above price is capped, loan 0")
  const overPct = resolveDownPayment(200000, 120, "percent")
  check(overPct.capped && overPct.percent === 100 && overPct.loan === 0, "percent above 100 is capped, loan 0")

  const zero = resolveDownPayment(0, 5000, "amount")
  check(zero.percent === 0 && zero.loan === 0, "zero price: 0%, no loan")

  const none = resolveDownPayment(100000, 0, "percent")
  check(none.loan === 100000, "no down payment: loan = price (old sessions unchanged)")

  // Schedule runs on the loan, not the price.
  const r = generateSchedule({ amount: pct.loan, annualRate: 5.5, termYears: 25 }, {}, NO_AUTO, "shorten")
  approx(r.baseMonthlyPayment, calculateMonthlyPayment(160000, 5.5, 300), 1e-9, "installment based on the loan amount")
}

// --- Test 12: persistence round-trip ---
{
  const state = {
    amountStr: "120000",
    downPaymentStr: "15",
    downPaymentUnit: "percent",
    rateStr: "4.25",
    yearsStr: "30",
    commissionStr: "0.5",
    currency: "USD",
    mode: "lower",
    startDateStr: "2026-04-26",
    autoAmountStr: "1500",
    autoEveryStr: "6",
    autoTopUp: true,
    manualCovers: { 12: 5000, 24: 0, 36: 7500 },
  }
  const raw = serializePersisted(state)
  const back = parsePersisted(raw)
  // Sort-keyed compare so we don't trip over object property ordering.
  const norm = (o) => JSON.stringify(o, Object.keys(o).sort())
  if (norm(back) !== norm(state)) {
    failures++
    console.error(`FAIL persistence round-trip\n  before: ${norm(state)}\n  after:  ${norm(back)}`)
  } else {
    console.log(`ok   persistence round-trip preserves all fields`)
  }
}

// --- Test 13: parsePersisted is defensive against garbage ---
{
  const cases = [
    { raw: null, label: "null" },
    { raw: "", label: "empty string" },
    { raw: "not json", label: "non-JSON" },
    { raw: "null", label: "JSON null" },
    { raw: "42", label: "JSON primitive" },
    { raw: '{"mode":"crazy"}', label: "invalid mode" },
    { raw: '{"downPaymentUnit":"eur"}', label: "invalid down payment unit" },
    { raw: '{"amountStr":42}', label: "wrong type for amountStr" },
    { raw: '{"manualCovers":"oops"}', label: "wrong type for manualCovers" },
    { raw: '{"manualCovers":{"abc":100,"-2":50,"3":"not a number","4.5":99,"7":200}}', label: "manualCovers with bad keys/values" },
  ]
  for (const { raw, label } of cases) {
    let result
    try {
      result = parsePersisted(raw)
    } catch (err) {
      failures++
      console.error(`FAIL parsePersisted threw on ${label}: ${err}`)
      continue
    }
    if (typeof result !== "object" || result === null) {
      failures++
      console.error(`FAIL parsePersisted didn't return an object for ${label}`)
      continue
    }
    if (label === "invalid mode" && "mode" in result) {
      failures++
      console.error(`FAIL invalid mode should be dropped, got ${result.mode}`)
      continue
    }
    if (label === "invalid down payment unit" && "downPaymentUnit" in result) {
      failures++
      console.error(`FAIL invalid downPaymentUnit should be dropped, got ${result.downPaymentUnit}`)
      continue
    }
    if (label === "wrong type for amountStr" && "amountStr" in result) {
      failures++
      console.error(`FAIL non-string amountStr should be dropped`)
      continue
    }
    if (label === "manualCovers with bad keys/values") {
      const expected = { 7: 200 }
      if (JSON.stringify(result.manualCovers) !== JSON.stringify(expected)) {
        failures++
        console.error(`FAIL manualCovers should keep only valid entries, got ${JSON.stringify(result.manualCovers)}`)
        continue
      }
    }
    console.log(`ok   parsePersisted handles ${label}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
} else {
  console.log("\nAll math sanity checks passed.")
}
