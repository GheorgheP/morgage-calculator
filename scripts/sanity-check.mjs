// Sanity tests for the mortgage schedule generator.
// Runs via:   node scripts/sanity-check.mjs
// (Reads ../src/lib/mortgage.ts using node's --experimental-strip-types loader.)

import {
  generateSchedule,
  calculateMonthlyPayment,
  addMonths,
  parseISODate,
  mergeCovers,
} from "../src/lib/mortgage.ts"

let failures = 0
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

  const r = generateSchedule({ amount: 100000, annualRate: 5.5, termYears: 25 }, {}, "shorten")
  approx(r.monthsActual, 300, 0, "schedule length")
  approx(r.rows[r.rows.length - 1].balance, 0, 0.01, "final balance is zero")
  // Total interest over 25y on 100k @ 5.5% should be ≈ 84,226 (= 614.09 * 300 - 100000)
  approx(r.totalInterest, 614.09 * 300 - 100000, 5, "total interest matches payment*n - principal")
}

// --- Test 2: zero interest rate ---
{
  const r = generateSchedule({ amount: 12000, annualRate: 0, termYears: 1 }, {}, "shorten")
  approx(r.baseMonthlyPayment, 1000, 0.001, "0% rate => principal/n")
  approx(r.totalInterest, 0, 0.001, "0% rate => zero total interest")
  approx(r.monthsActual, 12, 0, "0% rate => exact term")
}

// --- Test 3: prepayment in shorten mode reduces months and total interest ---
{
  const baseline = generateSchedule({ amount: 100000, annualRate: 5.5, termYears: 25 }, {}, "shorten")
  const withCover = generateSchedule(
    { amount: 100000, annualRate: 5.5, termYears: 25 },
    { 1: 10000 }, // pay 10k in month 1; 1% commission => 9900 reduces principal
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
  const baseline = generateSchedule({ amount: 100000, annualRate: 5.5, termYears: 25 }, {}, "lower")
  const withCover = generateSchedule(
    { amount: 100000, annualRate: 5.5, termYears: 25 },
    { 1: 10000 },
    "lower",
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
  const r = generateSchedule({ amount: 250000, annualRate: 4.25, termYears: 30 }, { 24: 5000, 60: 7500 }, "shorten")
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

// --- Test 8: mergeCovers — auto fires on multiples of `every` only ---
{
  const merged = mergeCovers({}, { amount: 1000, every: 12 }, 36)
  const months = Object.keys(merged).map(Number).sort((a, b) => a - b)
  const expected = [12, 24, 36]
  if (JSON.stringify(months) !== JSON.stringify(expected)) {
    failures++
    console.error(`FAIL auto fires on multiples: got ${months}`)
  } else {
    console.log(`ok   auto fires on multiples of 12 only: [${months}]`)
  }
  if (merged[12] !== 1000) {
    failures++
    console.error(`FAIL auto amount: got ${merged[12]}`)
  } else {
    console.log(`ok   auto amount = 1000`)
  }
}

// --- Test 9: mergeCovers — manual overrides auto ---
{
  const merged = mergeCovers(
    { 12: 5000, 24: 0 },
    { amount: 1000, every: 12 },
    48
  )
  // Expectations:
  //   month 12 -> manual 5000 (overrides auto 1000)
  //   month 24 -> manual 0 (skip; not in map)
  //   month 36 -> auto 1000
  //   month 48 -> auto 1000
  if (merged[12] !== 5000) {
    failures++
    console.error(`FAIL manual overrides auto: month 12 = ${merged[12]}`)
  } else {
    console.log(`ok   manual override (5000) wins over auto (1000) at month 12`)
  }
  if (Object.prototype.hasOwnProperty.call(merged, 24)) {
    failures++
    console.error(`FAIL manual 0 should remove month 24, got ${merged[24]}`)
  } else {
    console.log(`ok   manual 0 at month 24 skips the auto cover`)
  }
  if (merged[36] !== 1000 || merged[48] !== 1000) {
    failures++
    console.error(`FAIL auto continues after override: 36=${merged[36]} 48=${merged[48]}`)
  } else {
    console.log(`ok   auto continues firing at months 36 and 48`)
  }
}

// --- Test 10: mergeCovers — disabled auto ---
{
  const a = mergeCovers({ 6: 500 }, { amount: 0, every: 12 }, 24)
  const b = mergeCovers({ 6: 500 }, { amount: 1000, every: 0 }, 24)
  if (Object.keys(a).length !== 1 || a[6] !== 500) {
    failures++
    console.error(`FAIL amount=0 should disable auto, got ${JSON.stringify(a)}`)
  } else {
    console.log(`ok   amount=0 disables auto, manual still works`)
  }
  if (Object.keys(b).length !== 1 || b[6] !== 500) {
    failures++
    console.error(`FAIL every=0 should disable auto, got ${JSON.stringify(b)}`)
  } else {
    console.log(`ok   every=0 disables auto, manual still works`)
  }
}

// --- Test 11: end-to-end — auto cover actually shortens the loan ---
{
  // 100k @ 5.5% over 25y, 5000 every 12 months, shorten mode.
  const merged = mergeCovers({}, { amount: 5000, every: 12 }, 25 * 12)
  const r = generateSchedule(
    { amount: 100000, annualRate: 5.5, termYears: 25 },
    merged,
    "shorten",
    0.01
  )
  if (r.monthsActual >= 25 * 12) {
    failures++
    console.error(`FAIL auto cover should shorten, got ${r.monthsActual}mo`)
  } else {
    console.log(`ok   recurring 5000/12mo shortens 300mo loan to ${r.monthsActual}mo`)
  }
  // Expected commission ≈ count_of_auto_months * 5000 * 0.01.
  // The schedule may finish before all scheduled covers are applied, so just
  // check that totalCommissions > 0 and is exactly 1% of totalCovers.
  const ratio = r.totalCommissions / r.totalCovers
  if (Math.abs(ratio - 0.01) > 1e-9) {
    failures++
    console.error(`FAIL commission ratio: got ${ratio}`)
  } else {
    console.log(`ok   commissions are exactly 1% of total covers`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
} else {
  console.log("\nAll math sanity checks passed.")
}
