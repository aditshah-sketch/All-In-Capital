// Founder form parser: deterministic "Label: value" lines, no model.
// Personal fields are split off into `founders` so they never travel with
// the rest of the form.

import { parseMoney } from "./money";

export type ParsedFounder = {
  idx: number;
  name: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  role?: string;
  background?: string;
};

export type ParsedForm = {
  fields: Record<string, string>;       // non-personal fields, keyed by snake_case label
  founders: ParsedFounder[];
  money: Record<string, number | null>; // round_size, pre/post-money, revenue in rupees
  unreadable: Record<string, string>;   // money fields we could not read, with their text
  lines: Record<string, number>;        // label -> line number (the "page" of a form citation)
};

const FOUNDER_RE = /^founder\s+(\d+)\s+(name|email|phone|linkedin|role|background)$/i;
const MONEY_FIELDS = ["round_size", "pre_money_valuation", "post_money_valuation", "monthly_revenue", "annual_recurring_revenue"];

export function snake(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function parseForm(text: string): ParsedForm {
  const fields: Record<string, string> = {};
  const lines: Record<string, number> = {};
  const byIdx = new Map<number, ParsedFounder>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const m = raw.match(/^\s*([^:]{2,60}):\s*(.*)$/);
    if (!m) return;
    const [, label, value] = m;
    const f = label.trim().match(FOUNDER_RE);
    if (f) {
      const idx = Number(f[1]);
      const rec = byIdx.get(idx) ?? { idx, name: "" };
      (rec as Record<string, unknown>)[f[2].toLowerCase()] = value.trim();
      byIdx.set(idx, rec);
      return;
    }
    const key = snake(label);
    fields[key] = value.trim();
    lines[key] = i + 1;
  });

  const money: Record<string, number | null> = {};
  const unreadable: Record<string, string> = {};
  for (const k of MONEY_FIELDS) {
    const v = fields[k];
    if (v === undefined) continue;
    if (/^(not shared|not applicable|n\/a|-)$/i.test(v)) {
      money[k] = null;
      continue;
    }
    const p = parseMoney(v);
    money[k] = p.rupees;
    if (p.rupees === null) unreadable[k] = v;
  }

  const founders = [...byIdx.values()].filter((f) => f.name).sort((a, b) => a.idx - b.idx);
  return { fields, founders, money, unreadable, lines };
}
