import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, assertSendLess, SendLessViolation, MAX_PASSAGES } from "../src/lib/gateway/redact";

const founders = [
  { idx: 1, name: "Asha Menon" },
  { idx: 2, name: "Ravi Kulkarni" },
];

test("founder names become [F1], [F2], including first/last names alone", () => {
  const out = redact("Asha Menon (CEO) and Ravi Kulkarni. Menon ran procurement; Ravi built the app.", founders);
  assert.equal(out, "[F1] (CEO) and [F2]. [F1] ran procurement; [F2] built the app.");
});

test("names are matched case-insensitively but not inside other words", () => {
  assert.equal(redact("ASHA said hi to Ashant", founders), "[F1] said hi to Ashant");
});

test("emails, phones and LinkedIn URLs are removed", () => {
  const out = redact(
    "Mail asha@example.com, call +91 90000 12345, see https://www.linkedin.com/in/asha-m and linkedin.com/in/x",
    founders,
  );
  assert.ok(!out.includes("@"));
  assert.ok(!out.includes("90000"));
  assert.ok(!/linkedin/i.test(out));
});

test("money and dates survive redaction", () => {
  const s = "Raised ₹2.5 Cr in 2024, ₹18 L revenue in Oct 2026, 1,900 borrowers";
  assert.equal(redact(s, founders), s);
});

test("guard throws on any personal data", () => {
  assert.throws(() => assertSendLess("contact a@b.co"), SendLessViolation);
  assert.throws(() => assertSendLess("ph +91 90000 12345"), SendLessViolation);
  assert.throws(() => assertSendLess("in.linkedin.com/in/foo"), SendLessViolation);
  assert.throws(() => assertSendLess("Asha said", { founderNames: ["Asha Menon"] }), SendLessViolation);
});

test("guard passes a redacted prompt", () => {
  const prompt = redact("Asha Menon, asha@example.com, +91 90000 12345", founders);
  assert.doesNotThrow(() => assertSendLess(prompt, { founderNames: founders.map((f) => f.name) }));
});

test("guard throws when a prompt carries more than the top memo passages", () => {
  const ok = Array.from({ length: MAX_PASSAGES }, (_, i) => `<passage id="${i}">x</passage>`).join("\n");
  assert.doesNotThrow(() => assertSendLess(ok));
  assert.throws(() => assertSendLess(`${ok}\n<passage id="x">y</passage>`), /memo passages/);
});

test("guard does not mistake ₹ amounts or years for phones", () => {
  assert.doesNotThrow(() => assertSendLess("₹9,120 Cr TAM; 3.8 Cr households; FY2026; 1,20,000 users"));
});
