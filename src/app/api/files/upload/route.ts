import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { createClient } from "@/lib/supabase/server";
import { uploadInputFiles, uploadSharedInputs } from "@/lib/storage-sync";

export async function POST(request: NextRequest) {
  // Get authenticated user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const uploaded: string[] = [];

  const problemName = (formData.get("problemName") as string) || "Untitled";
  const problemType = (formData.get("problemType") as string) || "standard";
  const questionType = (formData.get("questionType") as string) || "function";
  const mode = (formData.get("mode") as string) || "practice";
  const scenarioLevel = (formData.get("scenarioLevel") as string) || "none";

  // Create problem record in Supabase
  const { data: problem, error: dbError } = await supabase
    .from("problems")
    .insert({
      created_by: user.id,
      name: problemName,
      question_type: questionType,
      mode: mode,
      scenario_level: scenarioLevel,
      status: "draft",
    })
    .select("id")
    .single();

  if (dbError || !problem) {
    return NextResponse.json(
      { error: "Failed to create problem record" },
      { status: 500 }
    );
  }

  const problemId = problem.id;

  // Build the metadata header
  const header = `# Problem: ${problemName}\n# Type: ${problemType}\n# Scenario Level: ${scenarioLevel}\n`;

  const filesToUpload: { name: string; content: Buffer }[] = [];

  const problemMd = formData.get("problemMd") as File | null;
  if (problemMd) {
    const bytes = await problemMd.arrayBuffer();
    const originalContent = Buffer.from(bytes).toString("utf-8");

    // Strip existing metadata lines if present
    const lines = originalContent.split("\n");
    const contentLines: string[] = [];
    for (const line of lines) {
      if (/^#\s*(Problem|Type|Use Scenario|Scenario Level)\s*:/i.test(line)) continue;
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
    const bytes = await solution.arrayBuffer();
    const ext = path.extname(solution.name) || ".py";
    filesToUpload.push({ name: `solution${ext}`, content: Buffer.from(bytes) });
    uploaded.push(`solution${ext}`);
  }

  if (uploaded.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // Upload files to Supabase Storage
  try {
    await uploadInputFiles(problemId, filesToUpload);

    // Also upload shared inputs (topics_list.txt etc.)
    const sharedInputsDir =
      process.env.PIPELINE_SHARED_INPUTS_DIR ||
      (process.env.PIPELINE_ROOT ? `${process.env.PIPELINE_ROOT}/Inputs` : null);

    if (sharedInputsDir) {
      await uploadSharedInputs(problemId, sharedInputsDir);
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to upload files: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 500 }
    );
  }

  // Update problem with storage path
  await supabase
    .from("problems")
    .update({ storage_path: `problems/${problemId}` })
    .eq("id", problemId);

  return NextResponse.json({ uploaded, problemId });
}
