// Runs generated Python against example inputs, in a throwaway temp dir.
//
// SECURITY NOTE: this executes model-generated code on your server. child_process
// gives NO real isolation. For production, run this inside a container / gVisor /
// firecracker / a dedicated code-execution service with no network, a CPU+memory
// cap, and a non-privileged user. The timeout + temp-dir here is the bare minimum,
// not a security boundary.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Example, ExampleRunResult } from "./types";

/** Normalize output for comparison: strip trailing spaces per line, drop trailing blank lines. */
function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "");
}

interface RunOne {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Minimal environment for the child so model-generated code does not inherit
 * deployment secrets (DATABASE_URL, API keys, ADMIN_SECRET_KEY, etc.). This is
 * defence-in-depth only — it is NOT a substitute for real sandboxing. */
function minimalEnv(): NodeJS.ProcessEnv {
  const allow = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TMPDIR", "SYSTEMROOT", "PYTHONIOENCODING"];
  const env = {} as NodeJS.ProcessEnv;
  for (const k of allow) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  // Avoid importing site-packages that could shadow stdlib unexpectedly.
  env.PYTHONDONTWRITEBYTECODE = "1";
  return env;
}

function runPython(
  pythonBin: string,
  scriptPath: string,
  stdin: string,
  timeoutMs: number,
): Promise<RunOne> {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: minimalEnv(),
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 1_000_000) child.kill("SIGKILL");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut });
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), exitCode: null, timedOut });
    });

    child.stdin?.write(stdin);
    child.stdin?.end();
  });
}

/**
 * Write the solution to a temp file and run it against every example.
 * Returns one result per example, in order.
 */
export async function verifySolution(
  solutionPython: string,
  examples: Example[],
  opts: { pythonBin: string; perExampleTimeoutMs: number },
): Promise<ExampleRunResult[]> {
  if (examples.length === 0) return [];

  const dir = await mkdtemp(join(tmpdir(), "cp-prep-"));
  const scriptPath = join(dir, "solution.py");
  try {
    await writeFile(scriptPath, solutionPython, "utf8");

    const results: ExampleRunResult[] = [];
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      const run = await runPython(
        opts.pythonBin,
        scriptPath,
        ex.input.endsWith("\n") ? ex.input : ex.input + "\n",
        opts.perExampleTimeoutMs,
      );

      const expected = normalize(ex.expectedOutput);
      const actual = normalize(run.stdout);

      let error: string | undefined;
      if (run.timedOut) error = `timed out after ${opts.perExampleTimeoutMs}ms`;
      else if (run.exitCode !== 0)
        error = `exited with code ${run.exitCode}${run.stderr ? `: ${run.stderr.slice(0, 2000)}` : ""}`;

      results.push({
        index: i,
        passed: !error && expected === actual,
        expected,
        actual,
        error,
      });
    }
    return results;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
