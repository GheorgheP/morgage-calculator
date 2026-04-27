// Persistence of the calculator's user-entered state.
//
// Schema is versioned via the storage key suffix (`:v1`). If the shape of
// `PersistedState` ever changes incompatibly, bump the version — older data
// will simply be ignored, and the calculator will fall back to defaults.

import type { PrepaymentMode } from "@/lib/mortgage"

export const STORAGE_KEY = "credit-calculator:v1"

export interface PersistedState {
  amountStr: string
  rateStr: string
  yearsStr: string
  commissionStr: string
  currency: string
  mode: PrepaymentMode
  startDateStr: string
  autoAmountStr: string
  autoEveryStr: string
  autoTopUp: boolean
  manualCovers: Record<number, number>
}

/**
 * Parse a previously serialized state string. Defensive against missing
 * fields, wrong types, and malformed JSON — anything we don't recognize
 * is dropped on the floor and the corresponding field is omitted from
 * the returned partial. Never throws.
 */
export function parsePersisted(raw: string | null): Partial<PersistedState> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== "object") return {}
  const obj = parsed as Record<string, unknown>
  const out: Partial<PersistedState> = {}

  const stringKeys: Array<keyof PersistedState> = [
    "amountStr",
    "rateStr",
    "yearsStr",
    "commissionStr",
    "currency",
    "startDateStr",
    "autoAmountStr",
    "autoEveryStr",
  ]
  for (const k of stringKeys) {
    const v = obj[k]
    if (typeof v === "string") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(out as any)[k] = v
    }
  }

  if (obj.mode === "shorten" || obj.mode === "lower") {
    out.mode = obj.mode
  }

  if (typeof obj.autoTopUp === "boolean") {
    out.autoTopUp = obj.autoTopUp
  }

  if (obj.manualCovers && typeof obj.manualCovers === "object") {
    const covers: Record<number, number> = {}
    for (const [k, v] of Object.entries(obj.manualCovers as Record<string, unknown>)) {
      const month = Number(k)
      if (
        Number.isInteger(month) &&
        month > 0 &&
        typeof v === "number" &&
        Number.isFinite(v) &&
        v >= 0
      ) {
        covers[month] = v
      }
    }
    out.manualCovers = covers
  }

  return out
}

export function serializePersisted(state: PersistedState): string {
  return JSON.stringify(state)
}

/** Browser-safe load. Returns {} during SSR or if storage is unavailable. */
export function loadPersisted(): Partial<PersistedState> {
  if (typeof window === "undefined") return {}
  try {
    return parsePersisted(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Private mode, quota exceeded on read, etc.
    return {}
  }
}

/** Browser-safe save. Silently ignores write failures (e.g. quota). */
export function savePersisted(state: PersistedState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, serializePersisted(state))
  } catch {
    // localStorage full / disabled — not worth crashing over.
  }
}
