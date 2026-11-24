// Seed integrity: the traps are where the pipeline expects them, and the
// form parser keeps personal data separate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseForm } from "../src/lib/form";
import { parseMemo, blindView } from "../src/lib/memo";
import { CRORE, LAKH } from "../src/lib/money";

const SEED = join(import.meta.dirname, "..", "seed");
const appDirs = readdirSync(join(SEED, "applications")).sort();
const form = (id: string) =>
  parseForm(readFileSync(join(SEED, "applications", appDirs.find((d) => d.startsWith(id))!, "form.txt"), "utf8"));
const deck = (id: string) =>
  readFileSync(join(SEED, "applications", appDirs.find((d) => d.startsWith(id))!, "deck.md"), "utf8");

test("ten applications, each with a form and a deck, all marked fictional", () => {
  assert.equal(appDirs.length, 10);
  for (const d of appDirs) {
    assert.match(readFileSync(join(SEED, "applications", d, "form.txt"), "utf8"), /^FICTIONAL TEST DATA/);
    assert.match(readFileSync(join(SEED, "applications", d, "deck.md"), "utf8"), /FICTIONAL TEST DATA/);
  }
});

test("form parser splits founders from fields and reads money", () => {
  const f = form("A01");
  assert.equal(f.fields.company, "PantryWise");
  assert.equal(f.founders.length, 2);
  assert.ok(f.founders[0].email?.includes("@"));
  assert.ok(!JSON.stringify(f.fields).includes("@"), "no email left in non-personal fields");
  assert.equal(f.money.round_size, 2 * CRORE);
  assert.equal(f.money.monthly_revenue, 9 * LAKH);
});

test("every form parses with a company, stage, round and at least one founder", () => {
  for (const id of appDirs.map((d) => d.slice(0, 3))) {
    const f = form(id);
    assert.ok(f.fields.company && f.fields.stage && f.founders.length >= 1, id);
    assert.equal(typeof f.money.round_size, "number", `${id} round size`);
    assert.deepEqual(f.unreadable, {}, `${id} unreadable money`);
  }
});

test("traps are planted", () => {
  assert.match(deck("A01"), /3\.8 Cr urban households × ₹2,400 .*= ₹91,200 Cr/);
  assert.equal(form("A02").fields.team_size, "9");
  assert.match(deck("A02"), /Team of 14/);
  assert.match(deck("A03"), /ex-Google/);
  assert.match(form("A03").founders[0].background ?? "", /intern/i);
  assert.match(deck("A04"), /NBFC partner's problem/);
  assert.match(deck("A05"), /VDA tax/);
  assert.match(deck("A08"), /ignore your previous instructions/i);
  assert.equal(form("A10").fields.stage, "Series A");
  assert.ok((form("A10").money.post_money_valuation ?? 0) > 40 * CRORE);
});

test("twelve memos; blind view hides the outcome", () => {
  const files = readdirSync(join(SEED, "memos"));
  assert.equal(files.length, 12);
  const memos = files.map((f) => parseMemo(readFileSync(join(SEED, "memos", f), "utf8")));
  for (const m of memos) {
    assert.ok(m.sections.what && m.sections.founder && m.sections.risks && m.sections.why, m.externalId);
    const blind = blindView(m);
    assert.ok(!/why we (invested|passed)/i.test(blind), m.externalId);
    assert.ok(!/\bwe (invested|passed)\b/i.test(blind), `${m.externalId} leaks outcome`);
  }
  assert.ok(memos.some((m) => m.outcome === "invested") && memos.some((m) => m.outcome === "passed"));
});

test("portfolio: 18 companies, 1 exited, 1 needs a description, overlap present", () => {
  const p = JSON.parse(readFileSync(join(SEED, "portfolio.json"), "utf8")) as Array<{ name: string; status: string; one_liner: string; domain: string }>;
  assert.equal(p.length, 18);
  assert.equal(p.filter((c) => c.status === "exited").length, 1);
  assert.equal(p.filter((c) => !c.one_liner).length, 1);
  assert.ok(p.some((c) => c.name === "Dukaan Dost"));
  assert.ok(p.some((c) => c.name === "MeetRecord"));
  assert.ok(p.every((c) => c.domain));
});

test("partner notes carry the two specifics", () => {
  const all = readdirSync(join(SEED, "meetings")).map((f) => readFileSync(join(SEED, "meetings", f), "utf8")).join("\n");
  assert.match(all, /a false alarm beats a missed conflict/i);
  assert.match(all, /Tuesday or Thursday afternoons?/i);
  assert.match(all, /Aditya joins deeptech calls/i);
});

test("no em dashes in seed text", () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : /\.(md|txt|json|csv)$/.test(e.name) ? [join(d, e.name)] : []);
  const bad = walk(SEED).filter((f) => readFileSync(f, "utf8").includes("—"));
  assert.deepEqual(bad, []);
});

test("every redacted deck and form passes the send-less guard", async () => {
  const { redact, assertSendLess } = await import("../src/lib/gateway/redact");
  for (const d of appDirs) {
    const f = form(d.slice(0, 3));
    const names = f.founders.map((x) => x.name);
    const refs = f.founders.map((x) => ({ idx: x.idx, name: x.name }));
    for (const text of [deck(d.slice(0, 3)), readFileSync(join(SEED, "applications", d, "form.txt"), "utf8")]) {
      const red = redact(text, refs);
      assert.doesNotThrow(() => assertSendLess(red, { founderNames: names }), d);
      assert.ok(!red.includes(names[0]), `${d} still names founder`);
    }
  }
});
