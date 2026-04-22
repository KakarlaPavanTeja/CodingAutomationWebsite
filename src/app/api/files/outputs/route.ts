import { NextRequest, NextResponse } from "next/server";
import { listOutputFiles } from "@/lib/storage-sync";
import { requireAuthApi } from "@/lib/auth/server";

export async function GET(request: NextRequest) {
  const auth = await requireAuthApi();
  if (auth.error) return auth.error;

  const problemId = request.nextUrl.searchParams.get("problemId");
  if (!problemId) {
    return NextResponse.json({ error: "problemId parameter required" }, { status: 400 });
  }

  try {
    const files = await listOutputFiles(problemId);
    return NextResponse.json({ files });
  } catch {
    return NextResponse.json({ files: [] });
  }
}
