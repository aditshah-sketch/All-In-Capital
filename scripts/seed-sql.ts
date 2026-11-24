// Emits the fictional seed data as one idempotent SQL script, for loading
// through the Supabase dashboard/MCP when no service key is at hand.
//   pnpm tsx scripts/seed-sql.ts > seed.sql
import { loadSeed } from "./seed";

const q = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const arr = (a: unknown) => (Array.isArray(a) ? `array[${a.map(q).join(",")}]::text[]` : "'{}'::text[]");

async function main() {
const d = await loadSeed();
const out: string[] = ["begin;"];
out.push(`insert into config_versions (kind, version, body, created_by) values ('thesis',1,${j(d.thesis)},'seed'),('rubric',1,${j(d.rubric)},'seed') on conflict (kind,version) do nothing;`);
for (const m of d.memos)
  out.push(`insert into memos (external_id, company, sector, stage, outcome, decided_on, sections) values (${q(m.externalId)},${q(m.company)},${q(m.sector)},${q(m.stage)},${q(m.outcome)},${q(m.date)},${j(m.sections)}) on conflict (external_id) do nothing;`);
for (const mt of d.meetings)
  out.push(`insert into meeting_notes (held_on, body) values (${q(mt.date)},${q(mt.body)}) on conflict (held_on) do nothing;`);
for (const p of d.portfolio)
  out.push(`insert into portfolio (name, one_liner, sector, status, tags, source_url, source_note, domain) values (${q(p.name)},${q(p.one_liner ?? "")},${q(p.sector)},${q(p.status)},${arr(p.tags)},${q(p.source_url)},${q(p.source_note)},${q(p.domain)}) on conflict (name) do nothing;`);
for (const a of d.apps) {
  const f = a.form.fields;
  out.push(`with app as (insert into applications (external_id, company, one_liner, sector, stage, form_fields, submitted_at, status) values (${q(f.application_id)},${q(f.company)},${q(f.one_liner)},${q(f.sector)},${q(f.stage)},${j({ ...f, money: a.form.money, unreadable: a.form.unreadable })},${q(new Date(`${f.submitted}T10:00:00+05:30`).toISOString())},'queued') on conflict (external_id) do nothing returning id),
fo as (insert into founders (application_id, idx, name, email, phone, linkedin, role, background) select app.id, x.* from app, (values ${a.form.founders.map((fo) => `(${fo.idx},${q(fo.name)},${q(fo.email)},${q(fo.phone)},${q(fo.linkedin)},${q(fo.role)},${q(fo.background)})`).join(",")}) as x(idx,name,email,phone,linkedin,role,background) returning 1),
deck as (insert into documents (application_id, kind, storage_path, page_count) select id,'deck',${q(`seed/applications/${a.dir}/deck.pdf`)},${a.pages.length} from app returning id),
dp as (insert into document_pages (document_id, page, text) select deck.id, x.page, x.text from deck, (values ${a.pages.map((t, i) => `(${i + 1},${q(t)})`).join(",")}) as x(page,text) returning 1),
form as (insert into documents (application_id, kind, storage_path, page_count) select id,'form',${q(`seed/applications/${a.dir}/form.txt`)},1 from app returning id),
fp as (insert into document_pages (document_id, page, text) select form.id, 1, ${q(a.formText)} from form returning 1)
select queue_send(id) from app;`);
}
out.push("commit;");
console.log(out.join("\n"));
}
main();
