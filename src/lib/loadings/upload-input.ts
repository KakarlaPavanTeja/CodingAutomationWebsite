import { inflateRawSync } from "zlib";
import { parseCodingQuestionsPayload, type CodingQuestionRow } from "./coding-questions-json";

/**
 * Minimal zip reader: enough for the flat archives the regenerator emits.
 *
 * Reads via the central directory rather than local file headers: archiver
 * (and many other zip writers) sets the streaming/data-descriptor flag even
 * for in-memory buffer sources, which leaves the local header's compressed
 * size at 0. The central directory's sizes are always authoritative.
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  const minOffset = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntry(buf: Buffer, wantedName: string): Buffer | null {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) return null;

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");

    if (name.replace(/\\/g, "/").split("/").pop() === wantedName) {
      const lhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? data : inflateRawSync(data);
    }

    offset = nameStart + nameLen + extraLen + commentLen;
  }
  return null;
}

function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
}

export async function extractQuestionsFromUpload(
  buffer: Buffer,
  filename: string,
): Promise<CodingQuestionRow[]> {
  let text: string;
  if (isZip(buffer)) {
    const entry = readZipEntry(buffer, "coding_questions.json");
    if (!entry) throw new Error(`No coding_questions.json inside ${filename}`);
    text = entry.toString("utf8");
  } else {
    text = buffer.toString("utf8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`Invalid JSON in ${filename}: ${(e as Error).message}`);
  }

  const questions = parseCodingQuestionsPayload(parsed);
  if (!questions?.length) {
    throw new Error(
      "Expected a non-empty array of questions (or an object with a coding_questions / questions / data / items array).",
    );
  }
  return questions;
}
