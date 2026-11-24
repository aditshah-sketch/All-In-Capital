// "Send less": founder names become [F1], [F2]; emails, phones and LinkedIn
// URLs never reach a model. The guard at the bottom THROWS, and the gateway
// runs it on every prompt before anything leaves the server.

export type FounderRef = { idx: number; name: string };

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Indian and international phone numbers: +91 90000 12345, 090000-12345, (022) 2345 6789
export const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)\d{3,5}[\s-]?\d{4,5}\b/g;
export const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/[^\s)>\]]*/gi;

/** Max memo/meeting passages one prompt may carry ("top retrieved", never all). */
export const MAX_PASSAGES = 4;
export const PASSAGE_OPEN = "<passage";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name tokens we mask: the full name, then each part of 3+ letters. */
function nameTokens(name: string): string[] {
  const full = name.trim().replace(/\s+/g, " ");
  const parts = full.split(" ").filter((p) => p.replace(/\W/g, "").length >= 3);
  return [full, ...parts].sort((a, b) => b.length - a.length);
}

export function redactContacts(text: string): string {
  return text
    .replace(LINKEDIN_RE, "[link removed]")
    .replace(EMAIL_RE, "[email removed]")
    .replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone removed]" : m));
}

export function redactNames(text: string, founders: FounderRef[]): string {
  let out = text;
  // Longest tokens first so "Asha Menon" wins over "Asha".
  const pairs = founders.flatMap((f) => nameTokens(f.name).map((t) => [t, `[F${f.idx}]`] as const));
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [token, tag] of pairs) {
    out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(token)}(?![\\p{L}])`, "giu"), tag);
  }
  // "[F1] [F1]" left by first+last replacement collapses to one tag.
  return out.replace(/(\[F\d+\])(\s+\1)+/g, "$1");
}

export function redact(text: string, founders: FounderRef[] = []): string {
  return redactNames(redactContacts(text), founders);
}

export class SendLessViolation extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Send-less guard blocked a prompt: ${reasons.join("; ")}`);
    this.name = "SendLessViolation";
  }
}

/** Throws if a prompt carries personal data or too many passages. */
export function assertSendLess(prompt: string, opts: { founderNames?: string[] } = {}): void {
  const reasons: string[] = [];
  if (new RegExp(EMAIL_RE.source, "i").test(prompt)) reasons.push("contains an email address");
  if (new RegExp(LINKEDIN_RE.source, "i").test(prompt)) reasons.push("contains a LinkedIn URL");
  const phones = prompt.match(new RegExp(PHONE_RE.source, "g")) ?? [];
  if (phones.some((p) => p.replace(/\D/g, "").length >= 10)) reasons.push("contains a phone number");
  for (const name of opts.founderNames ?? []) {
    for (const token of nameTokens(name)) {
      if (new RegExp(`(?<![\\p{L}])${escapeRe(token)}(?![\\p{L}])`, "iu").test(prompt)) {
        reasons.push(`contains a founder name ("${token[0]}…")`);
        break;
      }
    }
  }
  const passages = prompt.split(PASSAGE_OPEN).length - 1;
  if (passages > MAX_PASSAGES) reasons.push(`carries ${passages} memo passages (max ${MAX_PASSAGES})`);
  if (reasons.length) throw new SendLessViolation(reasons);
}
