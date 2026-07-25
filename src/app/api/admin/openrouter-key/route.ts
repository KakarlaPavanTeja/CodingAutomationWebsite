import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/server";
import { getOpenRouterKeyChoice, setOpenRouterKeyChoice } from "@/lib/openrouter-key";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  return NextResponse.json({
    choice: await getOpenRouterKeyChoice(),
    hasNew: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    hasOld: Boolean(process.env.OPENROUTER_API_KEY_OLD?.trim()),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;

  const body = (await req.json().catch(() => null)) as { choice?: unknown } | null;
  const choice = body?.choice;
  if (choice !== "new" && choice !== "old") {
    return NextResponse.json({ error: "choice must be 'new' or 'old'" }, { status: 400 });
  }
  await setOpenRouterKeyChoice(choice);
  return NextResponse.json({ choice });
}
