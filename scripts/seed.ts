// Loads the fictional seed data into Supabase.
//   pnpm seed            -> dry run: parses everything, prints a summary, writes nothing
//   pnpm seed --write    -> writes to the TEST database (APP_ENV=test)
//   pnpm seed --write --live  -> required extra flag to touch the live database
// Embeddings are filled later by the pipeline (they need a model key).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { parseForm } from "../src/lib/form";
import { parseMemo } from "../src/lib/memo";
import { env } from "../src/lib/env";

const SEED = join(import.meta.dirname, "..", "seed");
const args = new Set(process.argv.slice(2));
const write = args.has("--write");

async function deckPages(path: string): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)));
  const { text } = await extractText(pdf, { mergePages: false });
  return text as string[];
}

export async function loadSeed() {
  const apps = [];
  for (const dir of readdirSync(join(SEED, "applications")).sort()) {
    const base = join(SEED, "applications", dir);
    const form = parseForm(readFileSync(join(base, "form.txt"), "utf8"));
    const pdfPath = join(base, "deck.pdf");
    if (!existsSync(pdfPath)) throw new Error(`${dir}: run "pnpm seed:build" first`);
    apps.push({ dir, form, formText: readFileSync(join(base, "form.txt"), "utf8"), pages: await deckPages(pdfPath) });
  }
  const memos = readdirSync(join(SEED, "memos")).sort().map((f) => parseMemo(readFileSync(join(SEED, "memos", f), "utf8")));
  const meetings = readdirSync(join(SEED, "meetings")).sort().map((f) => ({
    date: f.slice(0, 10), body: readFileSync(join(SEED, "meetings", f), "utf8"),
  }));
  const portfolio = JSON.parse(readFileSync(join(SEED, "portfolio.json"), "utf8")) as Array<Record<string, unknown>>;
  const thesis = JSON.parse(readFileSync(join(SEED, "config", "thesis.v1.json"), "utf8"));
  const rubric = JSON.parse(readFileSync(join(SEED, "config", "rubric.v1.json"), "utf8"));
  return { apps, memos, meetings, portfolio, thesis, rubric };
}

async function main() {
  const data = await loadSeed();
  console.log(`applications ${data.apps.length} · memos ${data.memos.length} · meetings ${data.meetings.length} · portfolio ${data.portfolio.length}`);
  for (const a of data.apps) {
    console.log(`  ${a.form.fields.application_id} ${a.form.fields.company.padEnd(16)} ${a.pages.length} deck pages, ${a.form.founders.length} founder(s)`);
  }
  if (!write) {
    console.log("Dry run. Nothing written. Use --write to load the test database.");
    return;
  }

  const e = env();
  if (e.APP_ENV === "live" && !args.has("--live")) throw new Error("APP_ENV=live: add --live if you really mean to seed the live database.");
  const { db } = await import("../src/lib/db-core");
  const sb = db();
  const must = <T>(r: { error: { message: string } | null; data: T }, what: string) => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data;
  };

  must(await sb.from("config_versions").upsert([
    { kind: "thesis", version: 1, body: data.thesis, created_by: "seed" },
    { kind: "rubric", version: 1, body: data.rubric, created_by: "seed" },
  ], { onConflict: "kind,version" }), "config");

  for (const m of data.memos) {
    must(await sb.from("memos").upsert({
      external_id: m.externalId, company: m.company, sector: m.sector, stage: m.stage,
      outcome: m.outcome, decided_on: m.date, sections: m.sections,
    }, { onConflict: "external_id" }), `memo ${m.externalId}`);
  }
  for (const mt of data.meetings) {
    must(await sb.from("meeting_notes").upsert({ held_on: mt.date, body: mt.body }, { onConflict: "held_on" }), `meeting ${mt.date}`);
  }
  for (const p of data.portfolio) {
    const row = Object.fromEntries(Object.entries(p).filter(([k]) => k !== "fictional"));
    must(await sb.from("portfolio").upsert(row, { onConflict: "name" }), `portfolio ${p.name}`);
  }

  for (const a of data.apps) {
    const f = a.form.fields;
    const app = must(await sb.from("applications").upsert({
      external_id: f.application_id, company: f.company, one_liner: f.one_liner, sector: f.sector, stage: f.stage,
      form_fields: { ...f, money: a.form.money, unreadable: a.form.unreadable },
      submitted_at: new Date(`${f.submitted}T10:00:00+05:30`).toISOString(), status: "queued",
    }, { onConflict: "external_id" }).select("id").single(), `application ${f.application_id}`) as { id: string };

    for (const fo of a.form.founders) {
      must(await sb.from("founders").upsert({ application_id: app.id, ...fo }, { onConflict: "application_id,idx" }), "founder");
    }
    const deck = must(await sb.from("documents").upsert(
      { application_id: app.id, kind: "deck", storage_path: `seed/applications/${a.dir}/deck.pdf`, page_count: a.pages.length },
      { onConflict: "application_id,kind" }).select("id").single(), "deck doc") as { id: string };
    must(await sb.from("document_pages").upsert(a.pages.map((t, i) => ({ document_id: deck.id, page: i + 1, text: t }))), "deck pages");
    const form = must(await sb.from("documents").upsert(
      { application_id: app.id, kind: "form", storage_path: `seed/applications/${a.dir}/form.txt`, page_count: 1 },
      { onConflict: "application_id,kind" }).select("id").single(), "form doc") as { id: string };
    must(await sb.from("document_pages").upsert([{ document_id: form.id, page: 1, text: a.formText }]), "form page");
    must(await sb.rpc("queue_send", { p_application: app.id }), "queue");
  }
  console.log(`Seeded the ${e.APP_ENV} database.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
