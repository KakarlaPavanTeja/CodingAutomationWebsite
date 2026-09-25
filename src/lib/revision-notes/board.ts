/**
 * Sticky-notes board layout.
 *
 * Each page is laid out as a Scene: a flat list of positioned primitives
 * (text lines, boxes, sketchy paths, icons, rotated groups) with exact
 * coordinates, computed from real font metrics. `StickyBoard.tsx` just paints
 * a Scene; all measuring, wrapping and placement decisions live here, so they
 * can be unit-tested without rendering.
 *
 *   page 1 "approaches" — header + one tilted sticky note per approach, joined
 *                         by "optimize!" arrows that say why the next is better
 *   page 2 "cheatsheet" — complexity at a glance, dry run, and notes for
 *                         spotting the pattern, edge cases and pitfalls
 */
import { clean, textWidth, wrapCode, wrapText, type CodeLine, type Weight } from "./measure";
import { seededRng, sketchLine, sketchRoundedRect, type Rng } from "./sketch";
import type { RevisionApproach, RevisionNotes, RevisionPage } from "./types";

export type IconName =
  | "bulb"
  | "steps"
  | "code"
  | "star"
  | "clock"
  | "chart"
  | "play"
  | "target"
  | "search"
  | "warning";

export type Item =
  | {
      t: "text";
      x: number;
      y: number;
      lines: CodeLine[];
      size: number;
      lh: number;
      weight?: Weight;
      color?: string;
      /** With `w`, each line is centred in [x, x + w]. */
      align?: "left" | "center";
      w?: number;
    }
  | { t: "box"; x: number; y: number; w: number; h: number; fill: string; radius?: number; shadow?: string }
  | { t: "path"; d: string; color: string; width: number; opacity?: number }
  | { t: "icon"; name: IconName; x: number; y: number; size: number }
  | { t: "group"; x: number; y: number; w: number; h: number; rotate: number; items: Item[] };

export interface Scene {
  width: number;
  height: number;
  items: Item[];
}

/* ------------------------------ Palette ---------------------------------- */

export const INK = "#2b2620";
const SOFT_INK = "#4a4034";
const MUTED = "#6b5a45";
const HEAD = "#7a5b2e";
const ACCENT = "#b4410f";
const GOOD = "#2b8a3e";
const SHADOW = "6px 10px 18px rgba(80,60,20,0.22)";
const CARD = "#fffdf6";

const NOTE_COLORS = { first: "#fff1a8", middle: "#d6ecff", last: "#ffd6e3" };
const TAPE_COLORS = ["rgba(180,200,230,0.75)", "rgba(200,230,190,0.8)", "rgba(250,210,160,0.8)"];
const TILTS = [-1.6, 1.3, -1.1];
const PILL_COLORS = ["#ffe3a3", "#cde8ff", "#ffd1dc", "#d3f5d0"];

function noteColor(i: number, n: number): string {
  if (i === n - 1) return NOTE_COLORS.last;
  return i === 0 ? NOTE_COLORS.first : NOTE_COLORS.middle;
}

/* ------------------------------ Metrics ---------------------------------- */

export const BOARD = {
  padX: 64,
  padTop: 48,
  padBottom: 72,
  minWidth: 1200,
  noteWidthByCount: { 1: 700, 2: 600, 3: 540 } as Record<number, number>,
  arrowWidth: 230,
  cheatsheetWidth: 1460,
  note: { padTop: 34, padX: 32, padBottom: 30 },
};

/* ------------------------------ Helpers ---------------------------------- */

const asLines = (lines: string[]): CodeLine[] => lines.map((text) => ({ text, indent: 0 }));

/** Wrapped prose block; returns the item and its height. */
function prose(
  x: number,
  y: number,
  text: string,
  maxW: number,
  size: number,
  lh: number,
  opts: { weight?: Weight; color?: string; align?: "left" | "center" } = {},
): { item: Item; h: number } {
  const lines = wrapText(clean(text), size, maxW, opts.weight);
  return {
    item: { t: "text", x, y, lines: asLines(lines), size, lh, weight: opts.weight, color: opts.color, align: opts.align, w: maxW },
    h: lines.length * lh,
  };
}

function tape(noteW: number, i: number): Item {
  return {
    t: "group",
    x: noteW / 2 - 75,
    y: -18,
    w: 150,
    h: 36,
    rotate: i % 2 ? 3 : -4,
    items: [{ t: "box", x: 0, y: 0, w: 150, h: 36, fill: TAPE_COLORS[i % TAPE_COLORS.length] }],
  };
}

/* ------------------------------ Header ----------------------------------- */

function header(notes: RevisionNotes, width: number, rng: Rng, page: RevisionPage["kind"]): { items: Item[]; bottom: number } {
  const items: Item[] = [];
  const x = BOARD.padX;
  const innerW = width - 2 * BOARD.padX;
  let y = BOARD.padTop;

  if (page === "cheatsheet") {
    const k = prose(x, y, "CHEAT CORNER", innerW, 22, 28, { weight: "bold", color: ACCENT });
    items.push(k.item);
    y += k.h + 2;
  }

  const titleSize = page === "cheatsheet" ? 46 : 54;
  const titleLh = page === "cheatsheet" ? 56 : 64;
  const titleLines = wrapText(clean(notes.title), titleSize, innerW, "bold");
  items.push({ t: "text", x, y, lines: asLines(titleLines), size: titleSize, lh: titleLh, weight: "bold", color: INK });
  y += titleLines.length * titleLh;
  const lastW = textWidth(titleLines[titleLines.length - 1] ?? "", titleSize, "bold");
  items.push({ t: "path", d: sketchLine(rng, x, y - 2, x + Math.min(lastW + 16, innerW), y - 5, 2.4), color: "#e8590c", width: 4.5 });
  y += 16;

  if (page === "approaches") {
    if (notes.oneLiner) {
      const p = prose(x, y, notes.oneLiner, innerW, 25, 34, { color: SOFT_INK });
      items.push(p.item);
      y += p.h;
    }
    if (notes.example) {
      const p = prose(x, y, `e.g.  ${notes.example}`, innerW, 25, 34, { color: INK });
      items.push(p.item);
      y += p.h;
    }
    // Tags as pills, wrapping onto more rows if needed.
    if (notes.tags.length) {
      y += 10;
      let px = x;
      notes.tags.forEach((tag, i) => {
        const label = clean(tag);
        const w = textWidth(label, 19, "bold") + 30;
        if (px > x && px + w > x + innerW) {
          px = x;
          y += 42;
        }
        items.push({ t: "box", x: px, y, w, h: 34, fill: PILL_COLORS[i % PILL_COLORS.length], radius: 17 });
        items.push({ t: "text", x: px + 15, y, lines: asLines([label]), size: 19, lh: 34, weight: "bold", color: INK });
        px += w + 10;
      });
      y += 34;
    }
    if (notes.constraintsHint) {
      y += 10;
      items.push({ t: "icon", name: "clock", x, y: y + 2, size: 26 });
      const p = prose(x + 36, y, notes.constraintsHint, innerW - 36, 22, 30, { color: SOFT_INK });
      items.push(p.item);
      y += p.h;
    }
  }
  return { items, bottom: y };
}

/* --------------------------- Page 1: approaches -------------------------- */

interface NoteLayout {
  items: Item[];
  h: number;
}

function stamp(x: number, y: number, key: string, value: string, maxW: number, rng: Rng) {
  const lines = wrapText(clean(value), 22, maxW - 40, "bold");
  const contentW = Math.max(textWidth(key, 14, "bold"), ...lines.map((l) => textWidth(l, 22, "bold")));
  const w = Math.min(maxW, contentW + 40);
  const h = 8 + 18 + lines.length * 28 + 10;
  const items: Item[] = [
    { t: "path", d: sketchRoundedRect(rng, x, y, w, h, Math.min(h / 2, 26), 1.4), color: INK, width: 2.2 },
    { t: "text", x, y: y + 8, w, align: "center", lines: asLines([key]), size: 14, lh: 18, weight: "bold", color: HEAD },
    { t: "text", x, y: y + 26, w, align: "center", lines: asLines(lines), size: 22, lh: 28, weight: "bold", color: INK },
  ];
  return { items, w, h };
}

export function approachNote(a: RevisionApproach, noteW: number, rng: Rng): NoteLayout {
  const { padTop, padX, padBottom } = BOARD.note;
  const iw = noteW - 2 * padX;
  const items: Item[] = [];
  let y = padTop;

  const label = prose(padX, y, a.label, iw, 42, 50, { weight: "bold", color: ACCENT });
  items.push(label.item);
  y += label.h;
  if (a.name) {
    const name = prose(padX, y, a.name, iw, 22, 30, { color: MUTED });
    items.push(name.item);
    y += name.h;
  }
  y += 4;

  const section = (icon: IconName, title: string) => {
    y += 14;
    items.push({ t: "icon", name: icon, x: padX, y: y + 1, size: 22 });
    items.push({ t: "text", x: padX + 30, y, lines: asLines([title]), size: 19, lh: 26, weight: "bold", color: HEAD });
    y += 26;
  };

  section("bulb", "THE IDEA");
  const idea = prose(padX, y, a.intuition, iw, 23, 32, { color: INK });
  items.push(idea.item);
  y += idea.h;

  if (a.steps.length) {
    // Numbered code steps: what the code does, in the editorial's names.
    section("steps", "STEPS");
    a.steps.forEach((step, k) => {
      if (k > 0) y += 6;
      const num = `${k + 1}.`;
      items.push({ t: "text", x: padX, y, lines: asLines([num]), size: 22, lh: 30, weight: "bold", color: ACCENT });
      const p = prose(padX + 30, y, step, iw - 30, 22, 30, { color: INK });
      items.push(p.item);
      y += p.h;
    });
  } else {
    // Notes made before code steps existed: HOW + pseudocode.
    section("steps", "HOW");
    const how = prose(padX, y, a.approach, iw, 23, 32, { color: INK });
    items.push(how.item);
    y += how.h;
  }

  if (!a.steps.length && a.pseudocode.trim()) {
    section("code", "CODE");
    y += 6;
    const code = wrapCode(clean(a.pseudocode), 21, iw - 32);
    const boxH = 24 + code.length * 29;
    items.push({ t: "box", x: padX, y, w: iw, h: boxH, fill: "rgba(255,255,255,0.55)", radius: 10 });
    items.push({ t: "text", x: padX + 16, y: y + 12, lines: code, size: 21, lh: 29, color: INK });
    y += boxH;
  }

  // TC / SC stamps: side by side when they fit, stacked otherwise.
  y += 18;
  const tc = stamp(padX, y, "TIME", a.tc, iw, rng);
  const sideBySide = (sc: { w: number }) => tc.w + 14 + sc.w <= iw;
  const scProbe = stamp(0, 0, "SPACE", a.sc, iw, seededRng("probe"));
  if (sideBySide(scProbe)) {
    const sc = stamp(padX + tc.w + 14, y, "SPACE", a.sc, iw, rng);
    items.push(...tc.items, ...sc.items);
    y += Math.max(tc.h, sc.h);
  } else {
    items.push(...tc.items);
    y += tc.h + 12;
    const sc = stamp(padX, y, "SPACE", a.sc, iw, rng);
    items.push(...sc.items);
    y += sc.h;
  }

  if (a.takeaway) {
    y += 16;
    items.push({ t: "icon", name: "star", x: padX, y: y + 3, size: 24 });
    const r = prose(padX + 32, y, a.takeaway, iw - 32, 22, 30, { color: SOFT_INK });
    items.push(r.item);
    y += r.h;
  }

  return { items, h: y + padBottom };
}

function arrowColumn(x: number, y: number, w: number, why: string, rng: Rng): Item[] {
  const items: Item[] = [];
  const cx = x + w / 2;
  items.push({ t: "text", x, y, w, align: "center", lines: asLines(["optimize!"]), size: 24, lh: 30, weight: "bold", color: ACCENT });
  const ay = y + 58;
  items.push({ t: "path", d: sketchLine(rng, cx - 85, ay + 10, cx + 72, ay, 3), color: ACCENT, width: 4 });
  items.push({
    t: "path",
    d: `M${cx + 52} ${ay - 18} L${cx + 76} ${ay} L${cx + 50} ${ay + 16}`,
    color: ACCENT,
    width: 4,
  });
  if (why) {
    const p = prose(x + 12, ay + 30, why, w - 24, 20, 28, { color: SOFT_INK, align: "center" });
    items.push(p.item);
  }
  return items;
}

/**
 * Notes `approaches[from, to)` side by side. A page that does not start at the
 * first approach opens with the arrow from the previous page's last note, so
 * the "why it is better" story is never lost at a page break.
 */
export function layoutApproaches(notes: RevisionNotes, from = 0, to = notes.approaches.length): Scene {
  const rng = seededRng(`${notes.title}#approaches#${from}`);
  const shown = notes.approaches.slice(from, Math.max(from + 1, to));
  const n = Math.max(1, Math.min(shown.length, 3));
  const leading = from > 0 ? 1 : 0; // continuation arrow before the first note
  const noteW = BOARD.noteWidthByCount[n];
  const rowW = n * noteW + (n - 1 + leading) * BOARD.arrowWidth;
  const width = Math.max(BOARD.minWidth, rowW + 2 * BOARD.padX);

  const head = header(notes, width, rng, "approaches");
  const items: Item[] = [...head.items];
  const rowTop = head.bottom + 56;
  const x0 = Math.round((width - rowW) / 2) + leading * BOARD.arrowWidth;

  const layouts = shown.slice(0, n).map((a) => approachNote(a, noteW, rng));
  const maxH = Math.max(...layouts.map((l) => l.h));

  layouts.forEach((l, i) => {
    const x = x0 + i * (noteW + BOARD.arrowWidth);
    items.push({
      t: "group",
      x,
      y: rowTop,
      w: noteW,
      h: l.h,
      rotate: TILTS[(from + i) % TILTS.length],
      items: [
        { t: "box", x: 0, y: 0, w: noteW, h: l.h, fill: noteColor(from + i, notes.approaches.length), shadow: SHADOW },
        tape(noteW, from + i),
        ...l.items,
      ],
    });
    if (i > 0 || leading) {
      const ax = x - BOARD.arrowWidth;
      items.push(...arrowColumn(ax, rowTop + Math.round(maxH * 0.28), BOARD.arrowWidth, shown[i].whyBetter, rng));
    }
  });

  return { width, height: rowTop + maxH + BOARD.padBottom, items };
}

/* --------------------------- Page 2: cheatsheet -------------------------- */

interface Block {
  items: Item[];
  h: number;
}

/** A white index card (full width) with a title row. */
function card(w: number, icon: IconName, title: string, body: (x: number, y: number, iw: number) => Block): Block {
  const pad = 28;
  const iw = w - 2 * pad;
  const items: Item[] = [];
  items.push({ t: "icon", name: icon, x: pad, y: pad + 2, size: 30 });
  items.push({ t: "text", x: pad + 42, y: pad, lines: asLines(wrapText(clean(title), 30, iw - 42, "bold")), size: 30, lh: 38, weight: "bold", color: INK });
  const inner = body(pad, pad + 52, iw);
  const h = pad + 52 + inner.h + pad;
  return {
    items: [{ t: "box", x: 0, y: 0, w, h, fill: CARD, radius: 6, shadow: SHADOW }, ...inner.items.concat(items)],
    h,
  };
}

/** Simple sketched table: header row + wrapped cells, widths proportional to content. */
function table(
  x: number,
  y: number,
  iw: number,
  columns: string[],
  rows: string[][],
  rng: Rng,
  opts: { firstColBold?: boolean; firstColColors?: string[]; fixedFractions?: number[] } = {},
): Block {
  const H = { size: 18, lh: 26 };
  const C = { size: 22, lh: 30 };
  const gap = 20;
  const n = columns.length;
  let widths: number[];
  if (opts.fixedFractions) {
    widths = opts.fixedFractions.map((f) => f * (iw - gap * (n - 1)));
  } else {
    const natural = columns.map((c, ci) =>
      Math.max(textWidth(clean(c), H.size, "bold"), ...rows.map((r) => textWidth(clean(r[ci] ?? ""), C.size))) + 8,
    );
    // Scale to exactly fill the card: shrink (cells wrap) or spread out.
    const available = iw - gap * (n - 1);
    const total = natural.reduce((s, v) => s + v, 0);
    widths = natural.map((v) => (v * available) / total);
  }
  const xs = widths.map((_, i) => x + widths.slice(0, i).reduce((s, v) => s + v, 0) + gap * i);
  const items: Item[] = [];
  let cy = y;
  columns.forEach((c, i) => {
    items.push({ t: "text", x: xs[i], y: cy, lines: asLines(wrapText(clean(c), H.size, widths[i], "bold")), size: H.size, lh: H.lh, weight: "bold", color: HEAD });
  });
  cy += Math.max(...columns.map((c, i) => wrapText(clean(c), H.size, widths[i], "bold").length)) * H.lh + 6;
  rows.forEach((row, ri) => {
    items.push({ t: "path", d: sketchLine(rng, x, cy, x + iw, cy, 1.1), color: INK, width: 1.4, opacity: 0.55 });
    cy += 8;
    const cellLines = row.map((cell, ci) => {
      const bold = ci === 0 && opts.firstColBold;
      return wrapText(clean(cell), C.size, widths[ci], bold ? "bold" : "regular");
    });
    cellLines.forEach((lines, ci) => {
      const bold = ci === 0 && opts.firstColBold;
      items.push({
        t: "text",
        x: xs[ci],
        y: cy,
        lines: asLines(lines),
        size: C.size,
        lh: C.lh,
        weight: bold ? "bold" : "regular",
        color: ci === 0 && opts.firstColColors ? opts.firstColColors[ri] : INK,
      });
    });
    cy += Math.max(1, ...cellLines.map((l) => l.length)) * C.lh + 4;
  });
  return { items, h: cy - y };
}

/** A tilted sticky note with a heading and bullet points. */
function listNote(w: number, color: string, icon: IconName, title: string, bullets: string[]): Block {
  const padX = 30;
  const iw = w - 2 * padX;
  const items: Item[] = [];
  let y = 30;
  items.push({ t: "icon", name: icon, x: padX, y: y + 3, size: 30 });
  const t = prose(padX + 42, y, title, iw - 42, 30, 38, { weight: "bold", color: ACCENT });
  items.push(t.item);
  y += t.h + 8;
  bullets.forEach((b, i) => {
    if (i > 0) y += 8;
    items.push({ t: "text", x: padX, y, lines: asLines(["•"]), size: 23, lh: 32, weight: "bold", color: INK });
    const p = prose(padX + 24, y, b, iw - 24, 23, 32, { color: INK });
    items.push(p.item);
    y += p.h;
  });
  const h = y + 30;
  return { items: [{ t: "box", x: 0, y: 0, w, h, fill: color, shadow: SHADOW }, ...items], h };
}

export function layoutCheatsheet(notes: RevisionNotes): Scene {
  const rng = seededRng(`${notes.title}#cheatsheet`);
  const width = BOARD.cheatsheetWidth;
  const innerW = width - 2 * BOARD.padX;
  const x = BOARD.padX;
  const head = header(notes, width, rng, "cheatsheet");
  const items: Item[] = [...head.items];
  let y = head.bottom + 40;
  let tilt = 0;

  const place = (block: Block, bx: number, w: number, rotate: number, withTape: boolean) => {
    items.push({ t: "group", x: bx, y, w, h: block.h, rotate, items: withTape ? [...block.items, tape(w, tilt++)] : block.items });
  };

  // Complexity at a glance.
  const n = notes.approaches.length;
  const colors = notes.approaches.map((_, i) => (i === n - 1 ? GOOD : i === 0 ? ACCENT : "#1c7ed6"));
  const complexity = card(innerW, "chart", "Complexity at a glance", (cx, cy, iw) =>
    table(
      cx,
      cy,
      iw,
      ["APPROACH", "TECHNIQUE", "TIME", "SPACE"],
      notes.approaches.map((a) => [a.label, a.name, a.tc, a.sc]),
      rng,
      { firstColBold: true, firstColColors: colors, fixedFractions: [0.17, 0.35, 0.26, 0.22] },
    ),
  );
  place(complexity, x, innerW, -0.35, true);
  y += complexity.h + 44;

  // Dry run.
  const dr = notes.dryRun;
  if (dr) {
    const title = dr.approach ? `Dry run · ${dr.approach}` : "Dry run";
    const block = card(innerW, "play", title, (cx, cy, iw) => {
      const parts: Item[] = [];
      let h = 0;
      if (dr.input) {
        const p = prose(cx, cy, `Input:  ${dr.input}`, iw, 23, 32, { color: SOFT_INK });
        parts.push(p.item);
        h += p.h + 10;
      }
      const t = table(cx, cy + h, iw, dr.columns, dr.rows, rng);
      parts.push(...t.items);
      h += t.h;
      if (dr.result) {
        h += 10;
        const p = prose(cx, cy + h, `Result:  ${dr.result}`, iw, 24, 32, { weight: "bold", color: GOOD });
        parts.push(p.item);
        h += p.h;
      }
      return { items: parts, h };
    });
    place(block, x, innerW, 0.3, true);
    y += block.h + 48;
  }

  // Pattern / edge cases / pitfalls as sticky notes in two masonry columns.
  const colW = (innerW - 44) / 2;
  const specs: [IconName, string, string, string[]][] = [
    ["target", "Spot the pattern", "#d3f5d0", notes.recognize],
    ["search", "Edge cases", "#d6ecff", notes.edgeCases],
    ["warning", "Pitfalls", "#ffd8a8", notes.pitfalls],
  ];
  const colBottoms = [y, y];
  let k = 0;
  for (const [icon, title, color, bullets] of specs) {
    if (!bullets.length) continue;
    const block = listNote(colW, color, icon, title, bullets);
    const col = colBottoms[0] <= colBottoms[1] ? 0 : 1;
    const bx = x + col * (colW + 44);
    items.push({
      t: "group",
      x: bx,
      y: colBottoms[col],
      w: colW,
      h: block.h,
      rotate: k % 2 ? 1.1 : -1.2,
      items: [...block.items, tape(colW, k)],
    });
    colBottoms[col] += block.h + 48;
    k++;
  }
  const bottom = k > 0 ? Math.max(...colBottoms) - 48 : y - 44;
  return { width, height: bottom + BOARD.padBottom, items };
}

export function layoutPage(notes: RevisionNotes, page: RevisionPage): Scene {
  return page.kind === "cheatsheet" ? layoutCheatsheet(notes) : layoutApproaches(notes, page.from, page.to);
}
