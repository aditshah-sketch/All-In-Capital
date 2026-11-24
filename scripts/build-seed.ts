// Renders each seed deck.md into deck.pdf, one PDF page per "## Page N".
// Every page carries a "FICTIONAL TEST DATA" footer.
//   pnpm seed:build

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const ROOT = join(import.meta.dirname, "..", "seed", "applications");
// The first font that has both ₹ (U+20B9) and × wins. Arial Unicode predates ₹.
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Georgia.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
];

function pickFont(): Buffer {
  for (const p of FONT_CANDIDATES) {
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    const f = (fontkit as unknown as { create(b: Buffer): { hasGlyphForCodePoint(c: number): boolean } }).create(buf);
    if (f.hasGlyphForCodePoint(0x20b9) && f.hasGlyphForCodePoint(0xd7)) return buf;
  }
  throw new Error("No font with ₹ and × found; add one to FONT_CANDIDATES.");
}

export function splitPages(md: string): { title: string; lines: string[] }[] {
  const pages: { title: string; lines: string[] }[] = [];
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+Page\s+\d+:\s*(.*)$/);
    if (h) pages.push({ title: h[1].trim(), lines: [] });
    else if (pages.length && !/^<!--.*-->$/.test(line.trim())) pages.at(-1)!.lines.push(line);
  }
  return pages;
}

/** Markdown to plain text lines: drop emphasis marks and table rules. */
function plain(line: string): string {
  if (/^\s*\|?\s*:?-{3,}/.test(line)) return "";
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:])/g, "$1$2")
    .replace(/^\s*[-*]\s+/, "• ")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s*\|\s*/g, "   ")
    .replace(/^#+\s*/, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

async function render(md: string, company: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(pickFont(), { subset: true });
  doc.setTitle(`${company} deck (fictional)`);

  const W = 842, H = 595, M = 48; // A4 landscape, like a slide
  for (const [i, p] of splitPages(md).entries()) {
    const page = doc.addPage([W, H]);
    page.drawText(p.title, { x: M, y: H - M - 10, size: 20, font, color: rgb(0.08, 0.09, 0.11) });
    let y = H - M - 46;
    for (const raw of p.lines) {
      const text = plain(raw);
      if (!text.trim()) { y -= 6; continue; }
      for (const l of wrap(text, font, 11, W - 2 * M)) {
        page.drawText(l, { x: M, y, size: 11, font, color: rgb(0.16, 0.18, 0.22) });
        y -= 16;
      }
    }
    page.drawText(`FICTIONAL TEST DATA. ${company}. Page ${i + 1}`, {
      x: M, y: 24, size: 8, font, color: rgb(0.42, 0.45, 0.5),
    });
  }
  return doc.save();
}

async function main() {
  for (const dir of readdirSync(ROOT).sort()) {
    const mdPath = join(ROOT, dir, "deck.md");
    if (!existsSync(mdPath)) continue;
    const md = readFileSync(mdPath, "utf8");
    const company = readFileSync(join(ROOT, dir, "form.txt"), "utf8").match(/^Company:\s*(.+)$/m)?.[1] ?? dir;
    const pdf = await render(md, company);
    writeFileSync(join(ROOT, dir, "deck.pdf"), pdf);
    console.log(`${dir}: ${splitPages(md).length} pages -> deck.pdf`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
