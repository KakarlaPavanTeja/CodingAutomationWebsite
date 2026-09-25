/**
 * Render one page of revision notes to a PNG with `next/og` (Satori + Resvg —
 * no headless browser, which matters on the slim Docker image).
 *
 * Fonts are read from disk (Node runtime) rather than bundled, so the 500 KB
 * `ImageResponse` bundle limit does not apply to them. The Docker image copies
 * the whole repo (`COPY . .`) and runs from /app, so `process.cwd()` resolves.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { layoutPage } from "./board";
import { FONT_FAMILY, StickyBoard } from "./StickyBoard";
import type { RevisionNotes, RevisionPage } from "./types";

const FONT_DIR = path.join(process.cwd(), "src", "lib", "revision-notes", "fonts");

type FontSpec = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
let fontsPromise: Promise<FontSpec[]> | null = null;

function loadFonts(): Promise<FontSpec[]> {
  fontsPromise ??= Promise.all(
    ([
      ["Kalam-Regular.ttf", 400],
      ["Kalam-Bold.ttf", 700],
    ] as const).map(async ([file, weight]) => {
      const buf = await readFile(path.join(FONT_DIR, file));
      const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      return { name: FONT_FAMILY, data, weight, style: "normal" as const };
    }),
  ).catch((err) => {
    fontsPromise = null; // allow a retry after a transient read failure
    throw err;
  });
  return fontsPromise;
}

export async function renderRevisionNotesImage(
  notes: RevisionNotes,
  page: RevisionPage = { kind: "approaches", from: 0, to: notes.approaches.length },
  headers?: Record<string, string>,
): Promise<ImageResponse> {
  const scene = layoutPage(notes, page);
  const fonts = await loadFonts();
  return new ImageResponse(<StickyBoard scene={scene} />, {
    width: scene.width,
    height: scene.height,
    fonts,
    headers,
  });
}
