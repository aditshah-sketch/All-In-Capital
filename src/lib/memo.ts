// Deal memo parser. Blind calibration only ever sees what/founder/risks.

export type Memo = {
  externalId: string;
  company: string;
  sector: string;
  stage: string;
  outcome: "invested" | "passed";
  date: string;
  sections: { what: string; founder: string; risks: string; why: string };
};

const SECTION_KEYS: Array<[RegExp, keyof Memo["sections"]]> = [
  [/^what it does$/i, "what"],
  [/^founder assessment$/i, "founder"],
  [/^risks and open questions$/i, "risks"],
  [/^why we (invested|passed)$/i, "why"],
];

export function parseMemo(md: string): Memo {
  const fm = md.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) throw new Error("Memo has no front matter");
  const meta = Object.fromEntries(
    fm[1].split("\n").map((l) => l.split(/:\s*/, 2) as [string, string]).filter(([k, v]) => k && v !== undefined),
  );
  const sections = { what: "", founder: "", risks: "", why: "" };
  let current: keyof typeof sections | null = null;
  for (const line of md.slice(fm[0].length).split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      current = SECTION_KEYS.find(([re]) => re.test(h[1]))?.[1] ?? null;
      continue;
    }
    if (current) sections[current] += `${line}\n`;
  }
  for (const k of Object.keys(sections) as (keyof typeof sections)[]) sections[k] = sections[k].trim();
  const outcome = meta.outcome?.trim();
  if (outcome !== "invested" && outcome !== "passed") throw new Error(`Bad memo outcome: ${outcome}`);
  return {
    externalId: meta.id, company: meta.company, sector: meta.sector, stage: meta.stage,
    outcome, date: meta.date, sections,
  };
}

/** What the blind scorer may see: no outcome, no stage label, no "Why we…". */
export function blindView(m: Memo): string {
  return `What it does\n${m.sections.what}\n\nFounder assessment\n${m.sections.founder}\n\nRisks and open questions\n${m.sections.risks}`;
}
