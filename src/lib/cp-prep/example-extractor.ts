import type { Example } from "./types";

const EXAMPLE_HEADER_RE =
  /(?:^|\n)(?:#{1,4}\s*)?\*{0,2}Example(?:\s+\d+)?\*{0,2}:?\s*(?:\n|$)/gi;

const INPUT_LABEL_RE =
  /\*\*(?:Input|Sample Input):?\*\*|(?:^|\n)(?:Sample Input|Input)\s*:?\s*(?:\n|$)/i;

const OUTPUT_LABEL_RE =
  /\*\*(?:Output|Sample Output|Expected Output):?\*\*|(?:^|\n)(?:Sample Output|Expected Output|Output)\s*:?\s*(?:\n|$)/i;

/** Extract content from a fenced code block starting at `startIdx`. */
function extractFenceBlock(text: string, startIdx: number): { content: string; endIdx: number } | null {
  const fenceStart = text.indexOf("```", startIdx);
  if (fenceStart === -1) return null;

  const contentStart = text.indexOf("\n", fenceStart);
  if (contentStart === -1) return null;

  const fenceEnd = text.indexOf("```", contentStart + 1);
  if (fenceEnd === -1) return null;

  const content = text.slice(contentStart + 1, fenceEnd).replace(/\n$/, "");
  return { content, endIdx: fenceEnd + 3 };
}

function isInputFormatLabel(text: string, index: number): boolean {
  const slice = text.slice(index, index + 40).toLowerCase();
  return slice.startsWith("input format") || slice.startsWith("**input format");
}

function isOutputFormatLabel(text: string, index: number): boolean {
  const slice = text.slice(index, index + 42).toLowerCase();
  return slice.startsWith("output format") || slice.startsWith("**output format");
}

/** Find input/output pair after a label (Input/Output) within a section. */
function extractLabeledPair(section: string): { input: string; output: string } | null {
  const inputMatch = section.match(INPUT_LABEL_RE);
  const outputMatch = section.match(OUTPUT_LABEL_RE);
  if (!inputMatch || !outputMatch) return null;

  const inputIdx = inputMatch.index ?? 0;
  const outputIdx = outputMatch.index ?? 0;
  if (outputIdx <= inputIdx) return null;
  if (isInputFormatLabel(section, inputIdx) || isOutputFormatLabel(section, outputIdx)) return null;

  const inputBlock = extractFenceBlock(section, inputIdx);
  const outputBlock = extractFenceBlock(section, outputIdx);
  if (!inputBlock || !outputBlock) return null;

  const input = inputBlock.content.trim();
  const output = outputBlock.content.trim();
  if (!input && !output) return null;

  return { input, output };
}

function pushExample(examples: Example[], seen: Set<string>, input: string, output: string) {
  const key = `${input}\0${output}`;
  if (seen.has(key)) return;
  seen.add(key);
  examples.push({ input, expectedOutput: output });
}

/**
 * Heuristically extract worked examples from problem text.
 * Supports CP sites, Claude-generated markdown, and pipeline-style headers.
 */
export function extractExamplesFromStatement(text: string): Example[] {
  const examples: Example[] = [];
  const seen = new Set<string>();

  const exampleSections = text.split(EXAMPLE_HEADER_RE);

  for (let i = 1; i < exampleSections.length; i++) {
    const pair = extractLabeledPair(exampleSections[i]);
    if (!pair) continue;
    pushExample(examples, seen, pair.input, pair.output);
  }

  if (examples.length === 0) {
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const inputSlice = text.slice(searchFrom);
      const inputLabel = inputSlice.search(INPUT_LABEL_RE);
      if (inputLabel === -1) break;
      const absInput = searchFrom + inputLabel;
      if (isInputFormatLabel(text, absInput)) {
        searchFrom = absInput + 1;
        continue;
      }

      const outputSlice = text.slice(absInput);
      const outputLabel = outputSlice.search(OUTPUT_LABEL_RE);
      if (outputLabel === -1) break;
      const absOutput = absInput + outputLabel;
      if (isOutputFormatLabel(text, absOutput)) {
        searchFrom = absOutput + 1;
        continue;
      }

      const inputBlock = extractFenceBlock(text, absInput);
      const outputBlock = extractFenceBlock(text, absOutput);
      if (inputBlock && outputBlock) {
        const input = inputBlock.content.trim();
        const output = outputBlock.content.trim();
        if (input || output) {
          pushExample(examples, seen, input, output);
        }
        searchFrom = outputBlock.endIdx;
      } else {
        break;
      }
    }
  }

  return examples;
}

/** Prefer examples from Claude's generated statement; fall back to raw input hints. */
export function resolveVerifyExamples(
  generatedMarkdown: string,
  inputExamples: Example[],
): Example[] {
  const fromGenerated = extractExamplesFromStatement(generatedMarkdown);
  if (fromGenerated.length > 0) return fromGenerated;
  return inputExamples;
}
