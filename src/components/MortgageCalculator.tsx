import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

import {
  addMonths,
  formatCurrency,
  formatDate,
  generateSchedule,
  parseISODate,
  type PrepaymentMode,
} from "@/lib/mortgage"

import { loadPersisted, savePersisted } from "@/lib/persistence"

import { cn } from "@/lib/utils"

function todayISO(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

// Convert a string into a non-negative finite number, or 0 if invalid/empty.
function toNumber(value: string): number {
  if (value.trim() === "") return 0
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function MortgageCalculator() {
  // Read the previously persisted session ONCE, at mount.
  const initial = useMemo(() => loadPersisted(), [])

  // --- Loan inputs (kept as strings for clean editing UX) ---
  const [amountStr, setAmountStr] = useState(initial.amountStr ?? "100000")
  const [rateStr, setRateStr] = useState(initial.rateStr ?? "5.5")
  const [yearsStr, setYearsStr] = useState(initial.yearsStr ?? "25")
  const [commissionStr, setCommissionStr] = useState(
    initial.commissionStr ?? "1"
  ) // percent
  const [currency, setCurrency] = useState(initial.currency ?? "EUR")
  const [mode, setMode] = useState<PrepaymentMode>(initial.mode ?? "shorten")
  const [startDateStr, setStartDateStr] = useState<string>(
    initial.startDateStr ?? todayISO()
  )

  // --- Recurring "auto" cover: amount applied every N months. ---
  const [autoAmountStr, setAutoAmountStr] = useState(initial.autoAmountStr ?? "0")
  const [autoEveryStr, setAutoEveryStr] = useState(initial.autoEveryStr ?? "12")
  // When on (and in "lower" mode), each auto cover also adds the savings
  // between the original installment and the current (reduced) installment.
  const [autoTopUp, setAutoTopUp] = useState<boolean>(initial.autoTopUp ?? false)

  // Manual covers: month -> amount. A manual entry (even 0) ALWAYS wins over
  // the auto schedule for that month, so you can skip a single auto cover by
  // typing 0, or override a single auto with a different amount. Clearing the
  // input removes the manual override and lets auto kick back in.
  const [manualCovers, setManualCovers] = useState<Record<number, number>>(
    initial.manualCovers ?? {}
  )

  // Persist the entire session whenever any user-controlled field changes.
  useEffect(() => {
    savePersisted({
      amountStr,
      rateStr,
      yearsStr,
      commissionStr,
      currency,
      mode,
      startDateStr,
      autoAmountStr,
      autoEveryStr,
      autoTopUp,
      manualCovers,
    })
  }, [
    amountStr,
    rateStr,
    yearsStr,
    commissionStr,
    currency,
    mode,
    startDateStr,
    autoAmountStr,
    autoEveryStr,
    autoTopUp,
    manualCovers,
  ])

  // Parsed inputs.
  const amount = toNumber(amountStr)
  const annualRate = toNumber(rateStr)
  const termYears = Math.max(0, Math.floor(toNumber(yearsStr)))
  const commissionRate = Math.max(0, toNumber(commissionStr) / 100)
  const autoAmount = toNumber(autoAmountStr)
  const autoEvery = Math.max(0, Math.floor(toNumber(autoEveryStr)))
  const autoEnabled = autoAmount > 0 && autoEvery > 0

  // Top-up only makes sense in "lower" mode; "shorten" keeps payment fixed.
  const topUpActive = autoTopUp && mode === "lower"

  /** What the auto schedule would put in `month`, ignoring manual overrides
   *  and ignoring the dynamic top-up (used for tooltip / static display). */
  function autoCoverFor(month: number): number {
    if (!autoEnabled) return 0
    return month % autoEvery === 0 ? autoAmount : 0
  }

  // Recompute the schedule on every relevant change.
  const result = useMemo(
    () =>
      generateSchedule(
        { amount, annualRate, termYears },
        manualCovers,
        { amount: autoAmount, every: autoEvery, topUpFromPayment: autoTopUp },
        mode,
        commissionRate
      ),
    [
      amount,
      annualRate,
      termYears,
      manualCovers,
      autoAmount,
      autoEvery,
      autoTopUp,
      mode,
      commissionRate,
    ]
  )

  const monthsSaved = result.monthsOriginal - result.monthsActual

  const startDate = parseISODate(startDateStr)
  // First installment is one month after the loan start (mortgage convention).
  const payoffDate =
    startDate && result.monthsActual > 0
      ? addMonths(startDate, result.monthsActual)
      : null

  // What you would pay in total if you never prepaid.
  const baselineTotal = useMemo(() => {
    const baseline = generateSchedule(
      { amount, annualRate, termYears },
      {},
      { amount: 0, every: 0 },
      mode,
      commissionRate
    )
    return baseline.totalPaid
  }, [amount, annualRate, termYears, mode, commissionRate])

  const interestSaved = Math.max(0, baselineTotal - result.totalPaid)

  function setCoverFor(month: number, raw: string) {
    setManualCovers((prev) => {
      const next = { ...prev }
      if (raw.trim() === "") {
        // Empty input = remove manual override; auto (if any) takes over.
        delete next[month]
      } else {
        // Any parseable number (including 0) becomes a manual override.
        // Manual 0 explicitly skips the month (overrides any auto cover).
        const n = Number(raw)
        next[month] = Number.isFinite(n) && n >= 0 ? n : 0
      }
      return next
    })
  }

  function clearManualCovers() {
    setManualCovers({})
  }

  const currencyFmt = (n: number) => formatCurrency(n, currency)

  return (
    <div className="container py-8 max-w-7xl">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Credit Calculator
        </h1>
        <p className="text-muted-foreground mt-1">
          Mortgage annuity loan — model prepayments and see their effect.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3 mb-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Loan</CardTitle>
            <CardDescription>
              Annuity (equal monthly installments) with monthly compounding.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="amount">Loan amount</Label>
                <Input
                  id="amount"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1000}
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rate">Annual interest rate (%)</Label>
                <Input
                  id="rate"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.05}
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="years">Term (years)</Label>
                <Input
                  id="years"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={40}
                  step={1}
                  value={yearsStr}
                  onChange={(e) => setYearsStr(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="startDate">Start date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDateStr}
                  onChange={(e) => setStartDateStr(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="commission">
                  Prepayment commission (%)
                </Label>
                <Input
                  id="commission"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.1}
                  value={commissionStr}
                  onChange={(e) => setCommissionStr(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="currency">Currency</Label>
                <Input
                  id="currency"
                  type="text"
                  maxLength={4}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="EUR"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Prepayment mode</CardTitle>
              <CardDescription>
                How the bank should apply each prepayment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={(v) => v && setMode(v as PrepaymentMode)}
                variant="outline"
                className="grid grid-cols-1 gap-2"
              >
                <ToggleGroupItem value="shorten" className="justify-start h-auto py-3 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  <div className="text-left">
                    <div className="font-medium">Shorten period</div>
                    <div className="text-xs opacity-80">
                      Keep monthly payment, finish earlier.
                    </div>
                  </div>
                </ToggleGroupItem>
                <ToggleGroupItem value="lower" className="justify-start h-auto py-3 px-4 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  <div className="text-left">
                    <div className="font-medium">Lower payment</div>
                    <div className="text-xs opacity-80">
                      Keep term, recompute installment.
                    </div>
                  </div>
                </ToggleGroupItem>
              </ToggleGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auto cover</CardTitle>
              <CardDescription>
                Apply a recurring prepayment automatically. Manual entries in
                the table override this for individual months.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="autoAmount">Amount</Label>
                  <Input
                    id="autoAmount"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={100}
                    value={autoAmountStr}
                    onChange={(e) => setAutoAmountStr(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="autoEvery">Every (months)</Label>
                  <Input
                    id="autoEvery"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={autoEveryStr}
                    onChange={(e) => setAutoEveryStr(e.target.value)}
                    placeholder="12"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {autoEnabled
                    ? `Applies on month ${autoEvery}, ${autoEvery * 2}, ${autoEvery * 3}, …`
                    : "Set both fields above to enable."}
                </p>
                <Separator />
                <div className="flex items-start gap-2">
                  <input
                    id="autoTopUp"
                    type="checkbox"
                    checked={autoTopUp}
                    onChange={(e) => setAutoTopUp(e.target.checked)}
                    disabled={mode !== "lower"}
                    className="mt-1 h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
                  />
                  <div className="grid gap-1">
                    <Label
                      htmlFor="autoTopUp"
                      className={cn(
                        mode !== "lower" && "text-muted-foreground"
                      )}
                    >
                      Top up with payment savings
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {mode === "lower"
                        ? "Also add (initial payment − current payment) to each auto cover."
                        : "Only available in “Lower payment” mode."}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <SummaryStat
          label="Initial monthly"
          value={currencyFmt(result.baseMonthlyPayment)}
          hint={`Term: ${termYears}y · ${result.monthsOriginal} months`}
        />
        <SummaryStat
          label="Total to pay"
          value={currencyFmt(result.totalOutOfPocket)}
          hint={`Installments: ${currencyFmt(result.totalPaid)}`}
        />
        <SummaryStat
          label="Total interest"
          value={currencyFmt(result.totalInterest)}
          hint={
            interestSaved > 0
              ? `Saved vs no prepay: ${currencyFmt(interestSaved)}`
              : "No prepayments yet"
          }
        />
        <SummaryStat
          label="Paid off on"
          value={formatDate(payoffDate)}
          hint={
            mode === "shorten" && monthsSaved > 0
              ? `${result.monthsActual} months (${monthsSaved} saved)`
              : `${result.monthsActual} months`
          }
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Amortization schedule</CardTitle>
            <CardDescription>
              Type a prepayment in the &ldquo;Cover&rdquo; column. A faded
              placeholder marks months where the Auto cover will fire — type a
              value to override it, or 0 to skip that month.
              {commissionRate > 0
                ? ` ${(commissionRate * 100).toFixed(2)}% commission is deducted from each cover.`
                : ""}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={clearManualCovers}
            disabled={Object.keys(manualCovers).length === 0}
          >
            Clear manual
          </Button>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <Table wrapperClassName="max-h-[600px] rounded-md border">
            <TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_hsl(var(--border))]">
              <TableRow className="hover:bg-background">
                  <TableHead className="whitespace-nowrap w-12">#</TableHead>
                  <TableHead className="whitespace-nowrap w-32">Date</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Payment</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Interest</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Principal</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Cover</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Commission</TableHead>
                  <TableHead className="whitespace-nowrap text-right">
                    Reduces principal by
                  </TableHead>
                  <TableHead className="whitespace-nowrap text-right">Out of pocket</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      Enter a loan amount, rate and term above to generate a schedule.
                    </TableCell>
                  </TableRow>
                ) : (
                  result.rows.map((row) => {
                    const rowDate = startDate
                      ? addMonths(startDate, row.month)
                      : null
                    // Year band: even calendar years get a subtle background,
                    // odd ones stay clear. Falls back to month/12 if no start date.
                    const year = rowDate
                      ? rowDate.getFullYear()
                      : Math.ceil(row.month / 12)
                    const evenYear = year % 2 === 0
                    const hasManual = Object.prototype.hasOwnProperty.call(
                      manualCovers,
                      row.month
                    )
                    const manualValue = hasManual ? manualCovers[row.month] : null
                    // Static auto amount (without top-up) — for tooltips.
                    const baseAutoValue = autoCoverFor(row.month)
                    // Effective auto amount for this row, including any top-up.
                    // When no manual override, row.cover IS the auto amount.
                    const effectiveAutoValue = !hasManual ? row.cover : baseAutoValue
                    const topUpDelta =
                      topUpActive && baseAutoValue > 0 && !hasManual
                        ? Math.max(0, effectiveAutoValue - baseAutoValue)
                        : 0
                    return (
                    <TableRow
                      key={row.month}
                      className={cn(evenYear ? "bg-muted/40" : "")}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.month}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {rowDate ? formatDate(rowDate) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {currencyFmt(row.payment)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {currencyFmt(row.interest)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {currencyFmt(row.principal)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={100}
                          value={manualValue ?? ""}
                          onChange={(e) =>
                            setCoverFor(row.month, e.target.value)
                          }
                          className={cn(
                            "h-8 w-24 ml-auto text-right tabular-nums",
                            // Subtle highlight when this month has a manual override.
                            hasManual && "border-primary/60 bg-background",
                            // Highlight when an auto cover will fire here (and no manual override).
                            !hasManual && baseAutoValue > 0 && "border-dashed"
                          )}
                          placeholder={
                            effectiveAutoValue > 0
                              ? String(effectiveAutoValue)
                              : "0"
                          }
                          title={
                            hasManual
                              ? manualValue === 0
                                ? "Manual override: skip this month"
                                : "Manual override"
                              : baseAutoValue > 0
                                ? topUpDelta > 0
                                  ? `Auto: ${baseAutoValue} + top-up ${topUpDelta} every ${autoEvery} months`
                                  : `Auto: ${baseAutoValue} every ${autoEvery} months`
                                : ""
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.commission > 0 ? currencyFmt(row.commission) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.effectivePrincipalReduction > 0
                          ? currencyFmt(row.effectivePrincipalReduction)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {currencyFmt(row.totalOutOfPocket)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {currencyFmt(row.balance)}
                      </TableCell>
                    </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
        )}
      </CardContent>
    </Card>
  )
}
