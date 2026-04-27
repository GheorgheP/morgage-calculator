# Credit Calculator

A personal mortgage / annuity loan calculator with rich prepayment modeling.
Built for one user (me), so the UX is dense and biased toward "show me the
whole schedule and let me poke at it" rather than guided wizards.

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # production bundle into dist/
pnpm preview      # serve the production build locally
pnpm lint         # tsc --noEmit (typecheck only)
```

A standalone math sanity script lives at `scripts/sanity-check.mjs`. Run it
with native TypeScript stripping (Node 22+):

```bash
node --experimental-strip-types scripts/sanity-check.mjs
```

It exercises the annuity formula, the schedule generator, both prepayment
modes, the auto/manual cover merge, the date helpers, and the localStorage
persistence parser — including malformed-input cases.

## Stack

- Vite 5 + React 18 + TypeScript (strict)
- Tailwind CSS v3 with the standard shadcn slate theme
- shadcn/ui components vendored under `src/components/ui` (button, card,
  input, label, separator, table, toggle, toggle-group)
- Radix UI primitives, lucide-react, class-variance-authority,
  tailwind-merge, tailwindcss-animate

No backend, no analytics, no telemetry. Everything runs in the browser; the
last session is persisted in `localStorage`.

## What it does

Enter **loan amount**, **annual interest rate**, **term in years**, and a
**start date** — the app generates the full annuity schedule with monthly
compounding. The first installment falls one calendar month after the start
date (standard mortgage convention), with end-of-month overflow handled
correctly (Jan 31 + 1 month → Feb 28/29).

The schedule renders as a table with one row per installment:

| # | Date | Payment | Interest | Principal | Cover | Commission | Reduces principal by | Out of pocket | Balance |

Rows are banded by calendar year — even years get a subtle background tint —
and the column headers stay pinned at the top while you scroll.

Four summary cards above the table track the initial monthly installment,
total to pay, total interest, and the projected payoff date.

### Prepayment ("cover")

Every row has an editable **Cover** input. When you enter an amount, the
bank's commission (default 1%, configurable) is deducted from it, and only
the remainder reduces the outstanding principal. A global toggle controls
how the bank applies the prepayment:

- **Shorten period** — keep the monthly installment fixed; the loan
  terminates earlier than the original term.
- **Lower payment** — keep the original term; the installment is
  recalculated over the months remaining whenever a cover is applied (so
  multiple covers in "lower" mode keep ratcheting the installment down).

### Auto cover

A recurring prepayment can be configured with an **amount** and a
**period** (every N months). The auto schedule fires on month `N`, `2N`,
`3N`, … and is shown in the cover column as a faded placeholder with a
dashed border, so you can see at a glance which months will fire.

Manual entries always win:

- Type a number on a row → manual override (solid, primary-tinted border).
- Type `0` → explicit skip for that month, even if auto would have fired.
- Clear the input → the manual override is removed and auto kicks back in
  if applicable.

The "Clear manual" button wipes manual overrides only; the recurring
auto schedule is left intact. To disable auto entirely, set its amount or
period to 0.

### Persistence

Every user-editable value (loan inputs, dates, mode, auto config, manual
covers) is persisted to `localStorage` under `credit-calculator:v1`.
Reload the page and you pick up exactly where you left off. The parser is
defensive: malformed JSON, wrong types, or unknown shapes are silently
ignored and the calculator falls back to defaults.

If the schema ever changes incompatibly, bump the `:v1` suffix in
`src/lib/persistence.ts` — old entries will then be ignored automatically.

## File layout

```
src/
├── App.tsx                     # top-level layout
├── main.tsx                    # React entry
├── index.css                   # Tailwind + shadcn CSS variables
├── lib/
│   ├── utils.ts                # cn() helper
│   ├── mortgage.ts             # all loan math (pure functions)
│   └── persistence.ts          # localStorage save/load + pure parser
└── components/
    ├── MortgageCalculator.tsx  # the whole calculator UI
    └── ui/                     # shadcn components (button, card, table, …)

scripts/
└── sanity-check.mjs            # node-runnable math + parser tests
```

The math (`src/lib/mortgage.ts`) and the persistence parser
(`src/lib/persistence.ts`) are pure — no React, no DOM, no `window`. That
keeps them easy to test from Node and easy to reason about. The React
component is responsible only for state, layout, and stitching the pure
functions together.

## Adding more shadcn components

The project is configured with `components.json`, so:

```bash
pnpm dlx shadcn@latest add dialog
```

…drops the new component under `src/components/ui/` with the existing
theme and aliases applied.
