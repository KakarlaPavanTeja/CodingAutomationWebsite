import { NextRequest, NextResponse } from "next/server";
import { getLogContent } from "@/lib/storage-sync";

export async function GET(request: NextRequest) {
  const problemId = request.nextUrl.searchParams.get("problemId");
  const stepId = request.nextUrl.searchParams.get("stepId");
  const runId = request.nextUrl.searchParams.get("runId");
  const tail = parseInt(request.nextUrl.searchParams.get("tail") || "100", 10);

  if (!problemId || !stepId) {
    return NextResponse.json(
      { error: "problemId and stepId are required" },
      { status: 400 }
    );
  }

  try {
    // Read from pipeline_logs DB table
    const content = await getLogContent(problemId, stepId, runId || undefined);

    if (!content) {
      return NextResponse.json({
        content: "",
        totalLines: 0,
        source: "none",
      });
    }

    // Apply tail limit
    const lines = content.split("\n");
    const totalLines = lines.length;
    const tailedContent = tail > 0 && totalLines > tail
      ? lines.slice(-tail).join("\n")
      : content;

    return NextResponse.json({
      content: tailedContent,
      totalLines,
      source: "database",
    });
  } catch {
    return NextResponse.json({
      content: "",
      totalLines: 0,
      source: "none",
    });
  }
}
