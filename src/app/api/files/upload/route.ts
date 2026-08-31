import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { and, eq, inArray, ne } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { problems, problemAccess, profiles } from "@/lib/db/schema";
import { claimCpPrepUsageForProblem } from "@/lib/record-llm-usage";
import { uploadInputFiles, uploadOutputFile } from "@/lib/storage-sync";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_SOLUTION_EXTS = new Set([".py", ".cpp", ".java", ".js"]);
const ALLOWED_PROBLEM_EXTS = new Set([".md"]);

export async function POST(request: NextRequest) {
  const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Request too large. Max 10MB total." }, { status: 413 });
  }

  // Reject unauthenticated AND inactive accounts (P2-C1, app-wide policy).
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;
  const user = { id: auth.session.userId, email: auth.session.email };

  const formData = await request.formData();
  const uploaded: string[] = [];

  const problemName = (formData.get("problemName") as string) || "Untitled";
  const rawProblemType = (formData.get("problemType") as string) || "standard";
  const rawQuestionType = (formData.get("questionType") as string) || "function";
  const rawMode = (formData.get("mode") as string) || "practice";
  const rawScenarioLevel = (formData.get("scenarioLevel") as string) || "none";
  const rawDifficulty = (formData.get("difficulty") as string) || "";
  const rawScore = (formData.get("score") as string) || "";
  const rawCompanies = (formData.get("companies") as string) || "";

  // Clamp every client-supplied enum to the values the DB check constraints
  // accept, so a malformed field can't 500 the insert.
  const STRUCTURE_TYPES = new Set(["standard", "linked_list", "binary_tree"]);
  const structureType = STRUCTURE_TYPES.has(rawProblemType) ? rawProblemType : "standard";
  const questionType = rawQuestionType === "nonfunction" ? "nonfunction" : "function";
  const mode = rawMode === "exam" ? "exam" : "practice";
  const scenarioLevel = ["none", "light", "moderate", "heavy"].includes(rawScenarioLevel)
    ? rawScenarioLevel
    : "none";
  const difficulty = ["easy", "medium", "hard"].includes(rawDifficulty)
    ? rawDifficulty
    : null;
  // The owner-set score is FINAL, so a non-empty but invalid value is rejected
  // (consistent with PATCH /api/problems/[id]) rather than silently dropped.
  let score: number | null = null;
  if (rawScore.trim() !== "") {
    const parsedScore = parseInt(rawScore, 10);
    if (!Number.isFinite(parsedScore) || parsedScore < 1 || parsedScore > 100000) {
      return NextResponse.json({ error: "Invalid score" }, { status: 400 });
    }
    score = parsedScore;
  }

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
      difficulty,
      score,
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

  // The cp_prep LLM spend that produced this problem was billed before the
  // problem existed, so claim it now and keep a problem's cost in one place.
  void claimCpPrepUsageForProblem(problemId, user.id);

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

    if (mode === "practice" && rawCompanies.trim()) {
      // One company per line (matches the UI). Do NOT split on commas — a
      // single company name may contain a comma, e.g. "Alphabet, Inc." (UI-H2).
      const companyLines = rawCompanies
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean);
      if (companyLines.length > 0) {
        await uploadOutputFile(problemId, "Companies", companyLines.join("\n") + "\n");
        uploaded.push("Companies");
      }
    }
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

  // Optional: grant access to selected members at creation time.
  const rawMemberIds = formData.getAll("memberIds").map((m) => String(m));
  const memberIds = Array.from(
    new Set(rawMemberIds.filter((m) => UUID_RE.test(m) && m !== user.id)),
  ).slice(0, 200);

  if (memberIds.length > 0) {
    const validMembers = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          inArray(profiles.id, memberIds),
          eq(profiles.status, "active"),
          ne(profiles.id, user.id),
        ),
      );
    if (validMembers.length > 0) {
      await db
        .insert(problemAccess)
        .values(
          validMembers.map((m) => ({
            problemId,
            memberId: m.id,
            grantedBy: user.id,
          })),
        )
        .onConflictDoNothing();
    }
  }

  return NextResponse.json({ uploaded, problemId });
}
