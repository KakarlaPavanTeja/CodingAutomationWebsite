import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import path from "path";

export async function POST(request: NextRequest) {
  const pipelineRoot = process.env.PIPELINE_ROOT;
  if (!pipelineRoot) {
    return NextResponse.json({ error: "PIPELINE_ROOT not configured" }, { status: 500 });
  }

  const formData = await request.formData();
  const uploaded: string[] = [];

  const problemName = (formData.get("problemName") as string) || "Untitled";
  const problemType = (formData.get("problemType") as string) || "standard";
  const scenarioLevel = (formData.get("scenarioLevel") as string) || "none";

  // Build the metadata header
  const header = `# Problem: ${problemName}\n# Type: ${problemType}\n# Scenario Level: ${scenarioLevel}\n`;

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
    // Remove leading empty lines after stripping headers
    while (contentLines.length > 0 && contentLines[0].trim() === "") {
      contentLines.shift();
    }

    const finalContent = header + contentLines.join("\n");
    const filePath = path.join(pipelineRoot, "Inputs", "problem.md");
    await writeFile(filePath, finalContent);
    uploaded.push("problem.md");
  }

  const solution = formData.get("solution") as File | null;
  if (solution) {
    const bytes = await solution.arrayBuffer();
    const ext = path.extname(solution.name) || ".py";
    const filePath = path.join(pipelineRoot, "Inputs", `solution${ext}`);
    await writeFile(filePath, Buffer.from(bytes));
    uploaded.push(`solution${ext}`);
  }

  if (uploaded.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  return NextResponse.json({ uploaded });
}
