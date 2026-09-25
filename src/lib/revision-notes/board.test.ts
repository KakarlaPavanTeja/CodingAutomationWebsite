import { test } from "node:test";
import assert from "node:assert/strict";
import sample from "./sample-notes.json";
import { BOARD, layoutApproaches, layoutCheatsheet, type Item, type Scene } from "./board";
import { CODE_INDENT_EM_PER_SPACE, clean, hasGlyph, textWidth, wrapCode, wrapText } from "./measure";
import { pageTitle, parseRevisionNotes, revisionPages, sanitizeForFont, type RevisionNotes } from "./types";

function sampleNotes(): RevisionNotes {
  const parsed = parseRevisionNotes(sample);
  assert.ok(parsed.ok, "bundled sample must parse");
  return parsed.notes;
}

type Group = Extract<Item, { t: "group" }>;
const groups = (scene: Scene) => scene.items.filter((i): i is Group => i.t === "group");

/* ------------------------------ measure --------------------------------- */

test("wrapText never produces a line wider than the box", () => {
  const text =
    "Start i = j = 0. Append the smaller current value, or one copy when equal; skip any value equal to ans.back().";
  const lines = wrapText(text, 24, 300);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, 24) <= 300, line);
  assert.equal(lines.join(" "), text);
});

test("wrapText breaks a single word longer than the box", () => {
  const lines = wrapText("x".repeat(200), 24, 200);
  assert.ok(lines.length > 1);
  for (const line of lines) assert.ok(textWidth(line, 24) <= 200);
});

test("wrapCode keeps indentation and indents continuations", () => {
  const code = "while i < n\n  if a[i] > best and some very long condition that must wrap here\n    best = a[i]";
  const lines = wrapCode(code, 23, 320);
  assert.deepEqual(lines[0], { text: "while i < n", indent: 0 });
  assert.equal(lines[1].indent, 2);
  assert.ok(lines.some((l) => l.indent === 4 && l.text !== "best = a[i]"), "continuation is indented +2");
  assert.deepEqual(lines[lines.length - 1], { text: "best = a[i]", indent: 4 });
  for (const l of lines) {
    assert.ok(l.indent * CODE_INDENT_EM_PER_SPACE * 23 + textWidth(l.text, 23) <= 320, l.text);
  }
});

test("sanitizeForFont maps missing glyphs instead of dropping meaning", () => {
  assert.equal(sanitizeForFont("a → b", hasGlyph), "a -> b");
  assert.equal(sanitizeForFont("O(min(N, Σ))", hasGlyph), "O(min(N, sigma))");
  assert.equal(sanitizeForFont("x ≠ y ≤ z", hasGlyph), "x ≠ y ≤ z");
  assert.equal(sanitizeForFont("⌊n/2⌋", hasGlyph), "floor(n/2)");
  assert.equal(clean("N ≤ 10⁵"), "N ≤ 10^5");
});

/* ------------------------------ parsing --------------------------------- */

test("version 1 files still parse, with empty cheat-corner fields", () => {
  const v1 = {
    version: 1,
    title: "T",
    oneLiner: "o",
    example: "e",
    approaches: [{ label: "Optimal", name: "n", intuition: "i", approach: "a", pseudocode: "p", tc: "O(1)", sc: "O(1)", takeaway: "t" }],
  };
  const parsed = parseRevisionNotes(v1);
  assert.ok(parsed.ok);
  assert.equal(parsed.notes.version, 2);
  assert.deepEqual(parsed.notes.tags, []);
  assert.equal(parsed.notes.dryRun, null);
  assert.equal(parsed.notes.approaches[0].whyBetter, "");
  assert.deepEqual(revisionPages(parsed.notes), [{ kind: "approaches", from: 0, to: 1 }], "nothing for a cheat corner");
});

test("parseRevisionNotes rejects bad structure", () => {
  assert.equal(parseRevisionNotes(null).ok, false);
  assert.equal(parseRevisionNotes({ title: "x", approaches: [] }).ok, false);
  assert.equal(parseRevisionNotes({ title: "x", approaches: Array(9).fill({ label: "L" }) }).ok, false);
  const ragged = { ...sample, dryRun: { ...sample.dryRun, rows: [["only one cell"]] } };
  assert.equal(parseRevisionNotes(ragged).ok, false);
});

test("the sample has two pages", () => {
  assert.deepEqual(revisionPages(sampleNotes()), [{ kind: "approaches", from: 0, to: 2 }, { kind: "cheatsheet" }]);
});

test("more than three solutions spill onto balanced approach pages", () => {
  const notes = sampleNotes();
  const withN = (n: number) => ({
    ...notes,
    approaches: Array.from({ length: n }, (_, i) => ({ ...notes.approaches[i % 2], label: `S${i + 1}` })),
  });
  const ranges = (n: number) =>
    revisionPages(withN(n)).flatMap((p) => (p.kind === "approaches" ? [[p.from, p.to]] : []));
  assert.deepEqual(ranges(3), [[0, 3]]);
  assert.deepEqual(ranges(4), [[0, 2], [2, 4]]);
  assert.deepEqual(ranges(5), [[0, 3], [3, 5]]);
  assert.deepEqual(ranges(7), [[0, 3], [3, 5], [5, 7]]);
  const five = withN(5);
  assert.deepEqual(revisionPages(five).map((p) => pageTitle(p, five)), ["Approaches 1–3", "Approaches 4–5", "Cheat corner"]);
});

test("a continuation page opens with the arrow from the previous note", () => {
  const notes = sampleNotes();
  const four = { ...notes, approaches: [notes.approaches[0], notes.approaches[1], notes.approaches[0], notes.approaches[1]] };
  const optimize = (scene: Scene) =>
    scene.items.filter((i) => i.t === "text" && i.lines.some((l) => l.text === "optimize!")).length;
  assert.equal(optimize(layoutApproaches(four, 0, 2)), 1); // between notes 1 and 2
  const second = layoutApproaches(four, 2, 4);
  assert.equal(optimize(second), 2); // leading arrow + between notes 3 and 4
  const [firstNote] = groups(second);
  assert.ok(firstNote.x >= BOARD.padX + BOARD.arrowWidth - 1, "room for the leading arrow");
});

/* ------------------------------ page 1 ---------------------------------- */

test("approaches: one note per approach, left to right, never overlapping", () => {
  const notes = sampleNotes();
  for (const n of [1, 2, 3]) {
    const approaches = Array.from({ length: n }, (_, i) => notes.approaches[Math.min(i, 1)]);
    const scene = layoutApproaches({ ...notes, approaches });
    const g = groups(scene);
    assert.equal(g.length, n);
    for (let i = 1; i < n; i++) {
      assert.ok(g[i].x >= g[i - 1].x + g[i - 1].w + BOARD.arrowWidth - 1, "arrow space between notes");
    }
    const last = g[n - 1];
    assert.ok(last.x + last.w <= scene.width - BOARD.padX + 1);
    assert.ok(Math.max(...g.map((x) => x.y + x.h)) <= scene.height - BOARD.padBottom);
  }
});

test("approaches: every text line fits inside its note", () => {
  const scene = layoutApproaches(sampleNotes());
  for (const g of groups(scene)) {
    for (const item of g.items) {
      if (item.t !== "text") continue;
      for (const line of item.lines) {
        const left = item.align === "center" ? item.x : item.x + line.indent * CODE_INDENT_EM_PER_SPACE * item.size;
        const right = left + textWidth(line.text, item.size, item.weight);
        assert.ok(right <= g.w - BOARD.note.padX + 1, `"${line.text}" overflows its note`);
      }
    }
  }
});

test("approaches: longer text makes a taller note", () => {
  const notes = sampleNotes();
  const longer = structuredClone(notes);
  longer.approaches[0].intuition = `${notes.approaches[0].intuition} `.repeat(4);
  const firstNoteHeight = (n: RevisionNotes) => groups(layoutApproaches(n))[0].h;
  assert.ok(firstNoteHeight(longer) > firstNoteHeight(notes));
});

/* ------------------------------ page 2 ---------------------------------- */

test("cheatsheet: cards and notes stack without overlapping", () => {
  const scene = layoutCheatsheet(sampleNotes());
  const g = groups(scene);
  // complexity + dry run + pattern + edge cases + pitfalls
  assert.equal(g.length, 5);
  for (let i = 0; i < g.length; i++) {
    for (let j = i + 1; j < g.length; j++) {
      const a = g[i];
      const b = g[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `group ${i} overlaps group ${j}`);
    }
  }
  assert.ok(Math.max(...g.map((x) => x.y + x.h)) <= scene.height - BOARD.padBottom);
});

test("cheatsheet: empty sections are left out", () => {
  const notes = { ...sampleNotes(), dryRun: null, pitfalls: [], recognize: [] };
  assert.equal(groups(layoutCheatsheet(notes)).length, 2); // complexity + edge cases
});

/* ---------------------------- safety check ------------------------------ */

test("the safety-check report survives parsing; a malformed one is never 'verified'", () => {
  const withAudit = {
    ...sample,
    audit: {
      status: "needs_review",
      checks: [{ id: "complexity", label: "TC/SC match", level: "error", ok: false, details: ["note 2: TC differs"] }],
      issues: [{ path: "dryRun.rows[1]", severity: "error", problem: "x should be 2", fix: "2" }, { problem: "" }],
      model: "reviewer",
      checkedAt: "2026-09-25T10:00:00+00:00",
      repairs: 1,
      stale: false,
    },
  };
  const parsed = parseRevisionNotes(withAudit);
  assert.ok(parsed.ok);
  assert.equal(parsed.notes.audit?.status, "needs_review");
  assert.equal(parsed.notes.audit?.issues.length, 1, "issues without a problem are dropped");
  assert.deepEqual(parsed.notes.audit?.checks[0].details, ["note 2: TC differs"]);

  for (const bad of [{ status: "verified!" }, "passed", [], null]) {
    const p = parseRevisionNotes({ ...sample, audit: bad });
    assert.ok(p.ok);
    assert.equal(p.notes.audit, null, `${JSON.stringify(bad)} must not read as a report`);
  }
});

test("the audit never changes what is drawn", () => {
  const plain = parseRevisionNotes(sample);
  const audited = parseRevisionNotes({ ...sample, audit: { status: "passed", checks: [], issues: [] } });
  assert.ok(plain.ok && audited.ok);
  assert.deepEqual(layoutApproaches(audited.notes), layoutApproaches(plain.notes));
});

/* ------------------------------ code steps ------------------------------ */

const noteTexts = (scene: Scene, i: number) =>
  groups(scene)[i].items.flatMap((it) => (it.t === "text" ? it.lines.map((l) => l.text) : []));

test("notes show numbered code steps instead of pseudocode", () => {
  const notes = sampleNotes();
  assert.ok(notes.approaches.every((a) => a.steps.length > 0), "sample uses steps");
  const texts = noteTexts(layoutApproaches(notes), 1);
  assert.ok(texts.includes("STEPS"));
  assert.ok(!texts.includes("CODE") && !texts.includes("HOW"), "no code box or HOW for step notes");
  for (let k = 1; k <= notes.approaches[1].steps.length; k++) assert.ok(texts.includes(`${k}.`));
});

test("legacy notes (pseudocode, no steps) still render HOW and CODE", () => {
  const notes = sampleNotes();
  const legacy = structuredClone(notes);
  legacy.approaches = legacy.approaches.map((a) => ({ ...a, steps: [], approach: "Walk both arrays.", pseudocode: "i = 0\nreturn result" }));
  const texts = noteTexts(layoutApproaches(legacy), 1);
  assert.ok(texts.includes("HOW") && texts.includes("CODE"));
  assert.ok(!texts.includes("STEPS"));
});

test("steps survive parsing; old files without steps parse too", () => {
  const parsed = parseRevisionNotes(sample);
  assert.ok(parsed.ok);
  assert.equal(parsed.notes.approaches[1].steps.length, 3);
  const old = { ...sample, approaches: sample.approaches.map(({ steps: _steps, ...rest }) => ({ ...rest, pseudocode: "x = 1" })) };
  const p = parseRevisionNotes(old);
  assert.ok(p.ok);
  assert.deepEqual(p.notes.approaches[0].steps, []);
});
