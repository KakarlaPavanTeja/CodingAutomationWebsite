import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems } from "@/lib/db/schema";
import { uploadInputFiles, uploadSharedInputs } from "@/lib/storage-sync";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_SOLUTION_EXTS = new Set([".py", ".cpp", ".java", ".js"]);
const ALLOWED_PROBLEM_EXTS = new Set([".md"]);

export async function POST(request: NextRequest) {
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Request too large. Max 10MB total." }, { status: 413 });
  }

  const session = await getSession();
  const user = session ? { id: session.userId, email: session.email } : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const uploaded: string[] = [];

  const problemName = (formData.get("problemName") as string) || "Untitled";
  const rawProblemType = (formData.get("problemType") as string) || "standard";
  const rawQuestionType = (formData.get("questionType") as string) || "function";
  const rawMode = (formData.get("mode") as string) || "practice";
  const rawScenarioLevel = (formData.get("scenarioLevel") as string) || "none";

  // Clamp every client-supplied enum to the values the DB check constraints
  // accept, so a malformed field can't 500 the insert.
  const STRUCTURE_TYPES = new Set(["standard", "linked_list", "binary_tree"]);
  const structureType = STRUCTURE_TYPES.has(rawProblemType) ? rawProblemType : "standard";
  const questionType = rawQuestionType === "nonfunction" ? "nonfunction" : "function";
  const mode = rawMode === "exam" ? "exam" : "practice";
  const scenarioLevel = ["none", "light", "moderate", "heavy"].includes(rawScenarioLevel)
    ? rawScenarioLevel
    : "none";

  // Canonical structure form written into the problem.md `# Type:` header.
  // The Python pipeline compares against the lowercase-with-spaces form
  // ("standard" / "linked list" / "binary tree"), so map the underscore UI
  // ids to that form here.
  const STRUCTURE_HEADER_FORM: Record<string, string> = {
    standard: "standard",
    linked_list: "linked list",
    binary_tree: "binary tree",
  };

  const inserted = await db
    .insert(problems)
    .values({
      createdBy: user.id,
      name: problemName,
      questionType,
      structureType,
      mode,
      scenarioLevel,
      status: "draft",
    })
    .returning({ id: problems.id });

  const problemId = inserted[0]?.id;
  if (!problemId) {
    return NextResponse.json(
      { error: "Failed to create problem record" },
      { status: 500 }
    );
  }

  const header = `# Problem: ${problemName}\n# Type: ${STRUCTURE_HEADER_FORM[structureType]}\n# Question Type: ${questionType}\n# Scenario Level: ${scenarioLevel}\n`;

  const filesToUpload: { name: string; content: Buffer }[] = [];

  const problemMd = formData.get("problemMd") as File | null;
  if (problemMd) {
    const ext = path.extname(problemMd.name).toLowerCase();
    if (ext && !ALLOWED_PROBLEM_EXTS.has(ext)) {
      return NextResponse.json({ error: `Invalid problem file type: ${ext}. Only .md files are allowed.` }, { status: 400 });
    }
    if (problemMd.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Problem file too large (${(problemMd.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.` }, { status: 413 });
    }

    const bytes = await problemMd.arrayBuffer();
    const originalContent = Buffer.from(bytes).toString("utf-8");

    const lines = originalContent.split("\n");
    const contentLines: string[] = [];
    for (const line of lines) {
      if (/^#\s*(Problem|Question Type|Type|Use Scenario|Scenario Level)\s*:/i.test(line)) continue;
      contentLines.push(line);
    }
    while (contentLines.length > 0 && contentLines[0].trim() === "") {
      contentLines.shift();
    }

    const finalContent = header + contentLines.join("\n");
    filesToUpload.push({ name: "problem.md", content: Buffer.from(finalContent) });
    uploaded.push("problem.md");
  }

  const solution = formData.get("solution") as File | null;
  if (solution) {
    const solExt = path.extname(solution.name).toLowerCase();
    if (solExt && !ALLOWED_SOLUTION_EXTS.has(solExt)) {
      return NextResponse.json({ error: `Invalid solution file type: ${solExt}. Allowed: ${Array.from(ALLOWED_SOLUTION_EXTS).join(", ")}` }, { status: 400 });
    }
    if (solution.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `Solution file too large (${(solution.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.` }, { status: 413 });
    }

    const bytes = await solution.arrayBuffer();
    const ext = path.extname(solution.name) || ".py";
    filesToUpload.push({ name: `solution${ext}`, content: Buffer.from(bytes) });
    uploaded.push(`solution${ext}`);
  }

  if (uploaded.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  try {
    await uploadInputFiles(problemId, filesToUpload);

    const pipelineRoot = process.env.PIPELINE_ROOT || path.join(process.cwd(), "pipeline");
    const sharedInputsDir =
      process.env.PIPELINE_SHARED_INPUTS_DIR || path.join(pipelineRoot, "Inputs");

    await uploadSharedInputs(problemId, sharedInputsDir);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to upload files: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }

  await db
    .update(problems)
    .set({ storagePath: `problems/${problemId}` })
    .where(eq(problems.id, problemId));

  return NextResponse.json({ uploaded, problemId });
}
