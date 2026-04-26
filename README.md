# Credit Calculator

A personal mortgage / annuity loan calculator with prepayment ("credit cover") modeling.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v3
- shadcn/ui components (vendored under `src/components/ui`)
- Radix UI primitives, lucide-react icons

## Run

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Build

```bash
pnpm build
pnpm preview
```

## What it does

Enter the **loan amount**, **annual interest rate**, and **term in years** — the app generates the full annuity amortization schedule with monthly compounding.

For each month you can enter a **Cover** (prepayment toward principal). The bank's commission (default 1%) is deducted from the cover amount; only the remainder reduces the outstanding principal.

A global toggle controls how prepayments are applied:

- **Shorten period** — keep the monthly installment fixed; the loan finishes earlier.
- **Lower payment** — keep the original term; the installment is recomputed over the months remaining each time you enter a cover.

## File layout

```
src/
├── App.tsx
├── main.tsx
├── index.css                 # Tailwind + shadcn theme variables
├── lib/
│   ├── utils.ts              # cn() helper
│   └── mortgage.ts           # all loan math (pure functions)
└── components/
    ├── MortgageCalculator.tsx
    └── ui/                   # shadcn components (button, card, table, ...)
```

The amortization math lives in `src/lib/mortgage.ts` and is fully decoupled from React — easy to unit-test if you ever want to.

## Adding more shadcn components

This project is wired up with `components.json` so you can do, e.g.:

```bash
pnpm dlx shadcn@latest add dialog
```

…and the new component will land under `src/components/ui/`.
