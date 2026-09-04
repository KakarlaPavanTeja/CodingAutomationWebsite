import test from "node:test";
import assert from "node:assert/strict";
import archiver from "archiver";
import { PassThrough } from "stream";
import { extractQuestionsFromUpload } from "./upload-input";

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res, rej) => {
    sink.on("end", () => res());
    sink.on("error", rej);
    archive.on("error", rej);
  });
  archive.pipe(sink);
  for (const [name, body] of Object.entries(entries)) archive.append(body, { name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

test("reads a raw json array", async () => {
  const buf = Buffer.from(JSON.stringify([{ question_id: "q1" }]), "utf8");
  const out = await extractQuestionsFromUpload(buf, "coding_questions.json");
  assert.equal(out.length, 1);
});

test("reads a wrapper object", async () => {
  const buf = Buffer.from(JSON.stringify({ coding_questions: [{ question_id: "q1" }] }), "utf8");
  const out = await extractQuestionsFromUpload(buf, "anything.json");
  assert.equal(out.length, 1);
});

test("reads coding_questions.json out of a zip and ignores the link file", async () => {
  const buf = await zipOf({
    "coding_questions.json": JSON.stringify([{ question_id: "q1" }, { question_id: "q2" }]),
    "question_sets_questions.json": JSON.stringify([{ question_set_id: "s", question_id: "q1", order: 1 }]),
  });
  const out = await extractQuestionsFromUpload(buf, "regen.zip");
  assert.equal(out.length, 2);
});

test("rejects a zip with no coding_questions.json", async () => {
  const buf = await zipOf({ "readme.txt": "nothing here" });
  await assert.rejects(() => extractQuestionsFromUpload(buf, "x.zip"), /coding_questions\.json/);
});
