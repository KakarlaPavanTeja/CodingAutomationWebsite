/**
 * Render a revision_notes.json to PNGs locally — one file per page — for
 * iterating on the sticky-board design without running the app or the LLM.
 *
 *   npx tsx scripts/render-revision-notes.tsx [notes.json] [out-prefix]
 *
 * Defaults to the bundled sample (src/lib/revision-notes/sample-notes.json)
 * and writes revision_notes_p1.png, revision_notes_p2.png, …
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderRevisionNotesImage } from "../src/lib/revision-notes/render";
import { pageTitle, parseRevisionNotes, revisionPages } from "../src/lib/revision-notes/types";

async function main() {
  const input = process.argv[2] ?? "src/lib/revision-notes/sample-notes.json";
  const prefix = process.argv[3] ?? "revision_notes";
  const parsed = parseRevisionNotes(JSON.parse(readFileSync(input, "utf8")));
  if (!parsed.ok) {
    console.error(`Invalid revision notes:\n  - ${parsed.errors.join("\n  - ")}`);
    process.exit(1);
  }
  const pages = revisionPages(parsed.notes);
  for (const [i, page] of pages.entries()) {
    const res = await renderRevisionNotesImage(parsed.notes, page);
    const png = Buffer.from(await res.arrayBuffer());
    const out = `${prefix}_p${i + 1}.png`;
    writeFileSync(out, png);
    console.log(`Wrote ${out} — ${pageTitle(page, parsed.notes)} (${(png.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
