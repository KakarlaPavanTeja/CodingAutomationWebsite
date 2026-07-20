/**
 * Copy text to the clipboard. Uses the Clipboard API when available (secure
 * contexts: https / localhost), otherwise falls back to execCommand — needed
 * when the app is opened over LAN HTTP (e.g. http://172.x.x.x:5001), where
 * `navigator.clipboard` is undefined.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
