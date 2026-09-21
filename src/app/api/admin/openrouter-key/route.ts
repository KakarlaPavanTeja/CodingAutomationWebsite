import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/server";
import { getOpenRouterKeyChoice, setOpenRouterKeyChoice } from "@/lib/openrouter-key";
import { fetchOpenRouterKeyUsage } from "@/lib/openrouter-key-usage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.error) return auth.error;
  const newKey = process.env.OPENROUTER_API_KEY?.trim();
  const oldKey = process.env.OPENROUTER_API_KEY_OLD?.trim();
  const [choice, newUsage, oldUsage] = await Promise.all([
    getOpenRouterKeyChoice(),
    newKey ? fetchOpenRouterKeyUsage(newKey) : null,
    oldKey ? fetchOpenRouterKeyUsage(oldKey) : null,
  ]);
  return NextResponse.json({
    choice,
    hasNew: Boolean(newKey),
    hasOld: Boolean(oldKey),
    // Live numbers from OpenRouter (/key + /credits) per configured key; null if unreachable.
    usage: { new: newUsage, old: oldUsage },
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
