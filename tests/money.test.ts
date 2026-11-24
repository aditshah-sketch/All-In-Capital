import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney, formatInr, withinTolerance, relDiff, parseCount, CRORE, LAKH } from "../src/lib/money";

test("Indian units: lakh and crore", () => {
  assert.deepEqual(parseMoney("₹18 L"), { rupees: 18 * LAKH, currency: "INR" });
  assert.deepEqual(parseMoney("₹9,120 Cr"), { rupees: 9120 * CRORE, currency: "INR" });
  assert.deepEqual(parseMoney("Rs 2.5 crore"), { rupees: 2.5 * CRORE, currency: "INR" });
  assert.deepEqual(parseMoney("₹72 lakh"), { rupees: 72 * LAKH, currency: "INR" });
  assert.equal((parseMoney("INR 1,20,000") as { rupees: number }).rupees, 120000);
});

test("dollars convert at the given rate", () => {
  assert.deepEqual(parseMoney("$500K", 84), { rupees: 500_000 * 84, currency: "USD" });
});

test("unreadable amounts keep the text", () => {
  assert.deepEqual(parseMoney("about two crore-ish"), { rupees: null, unreadable: "about two crore-ish" });
});

test("does not read a following word as a unit", () => {
  assert.equal((parseMoney("₹610 Meta") as { rupees: number }).rupees, 610);
});

test("formats the Indian way", () => {
  assert.equal(formatInr(9120 * CRORE), "₹9,120 Cr");
  assert.equal(formatInr(18 * LAKH), "₹18 L");
  assert.equal(formatInr(2.5 * CRORE), "₹2.5 Cr");
  assert.equal(formatInr(610), "₹610");
});

test("TAM trap arithmetic: 3.8 Cr households × ₹2,400 = ₹9,120 Cr, not ₹91,200 Cr", () => {
  const tam = 3.8 * CRORE * 2400;
  assert.equal(formatInr(tam), "₹9,120 Cr");
  assert.equal(Math.round((91200 * CRORE) / tam), 10);
});

test("5% tolerance", () => {
  assert.ok(withinTolerance(100, 104));
  assert.ok(!withinTolerance(72 * LAKH, 1.2 * CRORE));
  assert.equal(relDiff(5, 5), 0);
});

test("counts", () => {
  assert.equal(parseCount("4.2 L downloads"), 420_000);
  assert.equal(parseCount("1,900 borrowers"), 1900);
  assert.equal(parseCount("28 M views"), 28_000_000);
});
