# Seed data: ALL FICTIONAL

Every company, founder, email, phone number and figure here is invented for
testing. None of it describes a real business or person.

| Folder | What | Source |
|---|---|---|
| `applications/A01..A10/` | founder form (`form.txt`), deck (`deck.md` → `deck.pdf`) | generated |
| `memos/M01..M12` | past deal memos (what / founder / risks / why) | generated |
| `meetings/` | five partner-meeting notes | generated |
| `portfolio.json` | 18 portfolio companies | generated |
| `config/` | thesis and rubric, version 1 | from the master prompt |
| `exports/loop1_screening.csv` | Loop 1 export, 40 rows (synthetic) | case Drive folder "Seed Data" |

The Loop 2 email export (60 rows) is in the same Drive folder and is pulled
in for the fine-tuning experiment (Phase 7) into `scripts/b6/data/`, which
is git-ignored.

## Planted traps

| App | Trap | Where |
|---|---|---|
| A01 PantryWise | TAM off by ×10 (₹91,200 Cr stated, inputs give ₹9,120 Cr) | deck p5 |
| A02 LedgerLoop | deck says team 14, ARR ₹1.2 Cr; form says 9 and ₹72 L | deck p6, p10 |
| A03 Vyom Drones | "ex-Google AI, ex-ISRO" vs a 3-month internship; no milestones | deck p8, p9 |
| A04 Sahukar Credit | "Defaults are the NBFC partner's problem" | deck p9, form |
| A05 BitBachat | only works if crypto tax is cut | deck p4, p7 |
| A06 StockSaathi | overlaps portfolio company Dukaan Dost | whole deck |
| A07 Mitti Ghee | clean and strong; cohort repeat table | deck p7, p9 |
| A08 ReelRasoi | vanity metrics only + a prompt-injection line | deck p5 |
| A09 Kosha Cells | long certification path, clear milestones | deck p7 |
| A10 SwiftLane | Series A, ₹45 Cr at ₹210 Cr post | deck p10, form |

Rebuild the PDFs with `pnpm seed:build`; load with `pnpm seed --write`.
