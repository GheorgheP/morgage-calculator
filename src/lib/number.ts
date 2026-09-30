// Parsing of user-typed numbers.
//
// Inputs keep the raw text the user typed (so "100,000" stays "100,000" on
// screen) and are parsed on use. Both "." and "," are accepted, because iOS
// numeric keyboards emit "," as the decimal separator in many locales.

/** Keep only characters that can be part of a typed number. */
export function sanitizeNumericInput(value: string): string {
  return value.replace(/[^\d.,'   ]/g, "")
}

export interface ParseDecimalOptions {
  /**
   * Allow thousands separators ("100,000", "1.000.000", "250,000.50").
   * Use for money amounts. Leave off for small decimals such as rates, where
   * a single separator is always the decimal point ("4,250" = 4.25).
   */
  grouping?: boolean
}

/**
 * Parse a user-typed number into a non-negative finite value, or 0 if it is
 * empty or invalid. Rules for deciding which separator is the decimal point:
 *
 *   - Both "." and "," present → the last one is the decimal point.
 *     "250,000.50" → 250000.5,  "1.000,50" → 1000.5
 *   - One kind, repeated → thousands separators (with `grouping`).
 *     "1.000.000" → 1000000
 *   - One kind, once, followed by exactly 3 digits and preceded by 1–3 digits
 *     (not starting with 0) → thousands separator (with `grouping`).
 *     "100,000" → 100000,  "0,500" → 0.5
 *   - Otherwise the separator is the decimal point. "1234,5" → 1234.5
 *
 * Spaces, apostrophes and other characters (currency symbols) are ignored.
 */
export function parseDecimal(
  value: string,
  { grouping = false }: ParseDecimalOptions = {}
): number {
  const s = value.replace(/[^\d.,]/g, "")
  if (!/\d/.test(s)) return 0

  const lastDot = s.lastIndexOf(".")
  const lastComma = s.lastIndexOf(",")
  let decimalAt = -1

  if (lastDot !== -1 && lastComma !== -1) {
    decimalAt = Math.max(lastDot, lastComma)
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ","
    const count = s.split(sep).length - 1
    const isGroup =
      grouping && (count > 1 || /^[1-9]\d{0,2}[.,]\d{3}$/.test(s))
    // Without grouping, a repeated separator keeps the first as the decimal
    // point and drops the rest.
    if (!isGroup) decimalAt = s.indexOf(sep)
  }

  const digits = (part: string) => part.replace(/[.,]/g, "")
  const n =
    decimalAt === -1
      ? Number(digits(s))
      : Number(
          `${digits(s.slice(0, decimalAt)) || "0"}.${digits(s.slice(decimalAt + 1)) || "0"}`
        )
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Parse a money amount (thousands separators allowed). */
export function parseAmount(value: string): number {
  return parseDecimal(value, { grouping: true })
}
