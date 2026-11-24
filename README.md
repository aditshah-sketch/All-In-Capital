# All In Capital: inbound triage

An internal tool for a pre-seed fund. It reads each founder application (form
and deck), checks the numbers, applies the fund's hard rules, scores it,
sorts it into Yes / Your call / No, and drafts the first email. Riya decides
and clicks send; after that the tool books the call from her calendar.

## Status

Phase 1 of 7: schema, seed data, model gateway, tests.

## Commands

```bash
pnpm install
pnpm test          # node:test via tsx
pnpm typecheck
pnpm seed:build    # render seed decks to PDF
pnpm seed          # dry run of the seed loader; --write loads the test DB
```

## Layout

- `supabase/migrations/` schema (RLS on, no browser grants), pgmq queue, pgvector, cron via Vault token
- `src/lib/gateway/` the ONLY code that calls a model: data guard, send-less guard, spend cap, cache, retries + fallback, logging
- `src/lib/money.ts` Indian units (L, Cr) and tolerances, in code
- `src/lib/form.ts`, `src/lib/memo.ts` deterministic parsers
- `seed/` fictional applications, memos, meetings, portfolio; see `seed/README.md`
- `tests/` unit tests, including the gateway-boundary test
