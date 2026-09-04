import test from "node:test";
import assert from "node:assert/strict";
import { regenerateQuestionIds } from "./regenerate-ids";

const A = "0a2ef131-fab4-4fa9-96a9-ea458cd9163f";
const B = "7c22d78b-fa1a-4279-b16e-7a1f1cae49f1";

test("replaces every uuid and keeps non-uuid values untouched", () => {
  const out = regenerateQuestionIds([
    { question: { question_id: A, short_text: "Keep me" }, test_cases: [{ id: B, weightage: 0.83 }] },
  ]);
  const q = out[0].question as Record<string, unknown>;
  const tc = (out[0].test_cases as Record<string, unknown>[])[0];
  assert.notEqual(q.question_id, A);
  assert.notEqual(tc.id, B);
  assert.equal(q.short_text, "Keep me");
  assert.equal(tc.weightage, 0.83);
});

test("maps repeated ids consistently", () => {
  const out = regenerateQuestionIds([{ a: A, b: A, c: B }]) as Record<string, string>[];
  assert.equal(out[0].a, out[0].b);
  assert.notEqual(out[0].a, out[0].c);
});

test("leaves strings that merely look id-ish alone", () => {
  const out = regenerateQuestionIds([{ note: "not-a-uuid", n: 5, ok: true, nil: null }]);
  assert.deepEqual(out[0], { note: "not-a-uuid", n: 5, ok: true, nil: null });
});
