/**
 * Text measurement and wrapping with the real advance widths of the bundled
 * Kalam font (kalam-metrics.json).
 *
 * Satori (behind `next/og`) needs the image height up front and wraps text with
 * its own engine, so an estimate that is off by a line either clips text or
 * leaves a gap. Instead every string is wrapped here and drawn line by line as
 * non-wrapping elements; heights — and therefore the canvas — are exact.
 */
import metrics from "./kalam-metrics.json";
import { sanitizeForFont } from "./types";

export type Weight = "regular" | "bold";

const WIDTHS: Record<Weight, Record<string, number>> = {
  regular: metrics.regular as Record<string, number>,
  bold: metrics.bold as Record<string, number>,
};
const UNKNOWN_CHAR_EM = 0.55;

export function hasGlyph(ch: string): boolean {
  return ch in WIDTHS.regular;
}

/** Replace characters the font cannot draw (see GLYPH_FALLBACKS). */
export function clean(text: string): string {
  return sanitizeForFont(text, hasGlyph);
}

export function textWidth(text: string, fontSize: number, weight: Weight = "regular"): number {
  const table = WIDTHS[weight];
  let em = 0;
  for (const ch of text) em += table[ch] ?? UNKNOWN_CHAR_EM;
  return em * fontSize;
}

/** Break one overlong word into pieces that each fit `maxWidth`. */
function breakWord(word: string, fontSize: number, maxWidth: number, weight: Weight): string[] {
  const parts: string[] = [];
  let cur = "";
  for (const ch of word) {
    if (cur && textWidth(cur + ch, fontSize, weight) > maxWidth) {
      parts.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Greedy word wrap for prose. Explicit newlines are kept as line breaks. */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  weight: Weight = "regular",
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let cur = "";
    for (const word of words) {
      const pieces =
        textWidth(word, fontSize, weight) > maxWidth
          ? breakWord(word, fontSize, maxWidth, weight)
          : [word];
      for (const piece of pieces) {
        const candidate = cur ? `${cur} ${piece}` : piece;
        if (cur && textWidth(candidate, fontSize, weight) > maxWidth) {
          lines.push(cur);
          cur = piece;
        } else {
          cur = candidate;
        }
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/**
 * Width of one leading space of pseudocode indentation, in em. Kalam is
 * proportional and its space is narrow, so literal spaces make nesting nearly
 * invisible; indentation is drawn as an offset of this many em per space.
 */
export const CODE_INDENT_EM_PER_SPACE = 0.62;

export interface CodeLine {
  text: string;
  /** Leading spaces (drawn as an offset, see CODE_INDENT_EM_PER_SPACE). */
  indent: number;
}

/**
 * Wrap pseudocode line by line, keeping each line's indentation. A line that
 * does not fit continues on the next row indented two extra spaces, so the
 * continuation reads as part of the same statement.
 */
export function wrapCode(code: string, fontSize: number, maxWidth: number): CodeLine[] {
  const out: CodeLine[] = [];
  const indentPx = (spaces: number) => spaces * CODE_INDENT_EM_PER_SPACE * fontSize;
  for (const raw of code.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^ */)![0].length;
    const body = line.slice(indent);
    if (indentPx(indent) + textWidth(body, fontSize) <= maxWidth) {
      out.push({ text: body, indent });
      continue;
    }
    const wrapped = wrapText(body, fontSize, maxWidth - indentPx(indent + 2));
    wrapped.forEach((piece, i) => out.push({ text: piece, indent: i === 0 ? indent : indent + 2 }));
  }
  return out;
}
