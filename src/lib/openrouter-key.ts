import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

// Which OpenRouter account key the app currently uses. "new" is the key already
// in OPENROUTER_API_KEY; "old" is OPENROUTER_API_KEY_OLD.
export type OpenRouterKeyChoice = "new" | "old";
const SETTING_KEY = "openrouter_key_choice";

export async function getOpenRouterKeyChoice(): Promise<OpenRouterKeyChoice> {
  try {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_KEY))
      .limit(1);
    return rows[0]?.value === "old" ? "old" : "new";
  } catch {
    // Default to the current (new) key if the setting can't be read.
    return "new";
  }
}

export async function setOpenRouterKeyChoice(choice: OpenRouterKeyChoice): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SETTING_KEY, value: choice, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: choice, updatedAt: new Date() },
    });
}

/** The actual OpenRouter API key for the currently-selected account, or
 * undefined if that account's env var is not set. */
export async function getActiveOpenRouterKey(): Promise<string | undefined> {
  const choice = await getOpenRouterKeyChoice();
  const key =
    choice === "old"
      ? process.env.OPENROUTER_API_KEY_OLD?.trim()
      : process.env.OPENROUTER_API_KEY?.trim();
  return key || undefined;
}
