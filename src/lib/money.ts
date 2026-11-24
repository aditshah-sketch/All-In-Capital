// Indian units, done in code. 1 L (lakh) = 1e5, 1 Cr (crore) = 1e7.
// Returns rupees as a number, or null with the text we couldn't read.

export const LAKH = 1e5;
export const CRORE = 1e7;

const UNIT: Record<string, number> = {
  l: LAKH, lakh: LAKH, lakhs: LAKH, lac: LAKH, lacs: LAKH,
  cr: CRORE, crore: CRORE, crores: CRORE,
  k: 1e3, thousand: 1e3,
  m: 1e6, mn: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
};

export type Money = { rupees: number; currency: "INR" | "USD" } | { rupees: null; unreadable: string };

const MONEY_RE =
  /(₹|rs\.?|inr|\$|usd)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|l|crores?|cr|thousand|k|million|mn|m|billion|bn|b)?\b/i;

/** Parse "₹9,120 Cr", "₹18 L", "Rs 2.5 crore", "$500K". usdToInr converts dollars. */
export function parseMoney(text: string, usdToInr = 84): Money {
  const t = text.trim();
  const m = t.match(MONEY_RE);
  if (!m || !m[2]) return { rupees: null, unreadable: t };
  const num = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(num)) return { rupees: null, unreadable: t };
  const mult = m[3] ? UNIT[m[3].toLowerCase()] ?? 1 : 1;
  const isUsd = !!m[1] && /\$|usd/i.test(m[1]);
  const rupees = num * mult * (isUsd ? usdToInr : 1);
  return { rupees: Math.round(rupees * 100) / 100, currency: isUsd ? "USD" : "INR" };
}

/** Format rupees the Indian way, choosing Cr or L. */
export function formatInr(rupees: number): string {
  const abs = Math.abs(rupees);
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
  if (abs >= CRORE) return `₹${fmt(Math.round((rupees / CRORE) * 100) / 100)} Cr`;
  if (abs >= LAKH) return `₹${fmt(Math.round((rupees / LAKH) * 100) / 100)} L`;
  return `₹${fmt(Math.round(rupees))}`;
}

/** Relative difference, symmetric: |a-b| / max(|a|,|b|). */
export function relDiff(a: number, b: number): number {
  if (a === b) return 0;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
}

export function withinTolerance(a: number, b: number, tol = 0.05): boolean {
  return relDiff(a, b) <= tol;
}

/** Parse plain counts with Indian or Western suffixes: "4.2 L downloads", "1,900", "28 M". */
export function parseCount(text: string): number | null {
  const m = text.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(lakhs?|l|crores?|cr|k|m|mn|million)?\b/i);
  if (!m) return null;
  const mult = m[2] ? UNIT[m[2].toLowerCase()] ?? 1 : 1;
  return Number(m[1].replace(/,/g, "")) * mult;
}
