/**
 * Django admin HTTP session (beta) — login + authenticated GET, no browser.
 *
 * Only used to count how many questions a question_set_id already holds; the
 * loading itself goes through the NKB REST API.
 */

import { NKB_BETA_ADMIN_URL, djangoAdminCredentials } from "./config";

function parseSetCookie(res: Response): string[] {
  const jarLines = res.headers.getSetCookie?.() ?? [];
  if (jarLines.length) return jarLines;
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractCsrf(html: string): string {
  const m =
    html.match(/name=['"]csrfmiddlewaretoken['"][^>]*value=['"]([^'"]+)['"]/i) ||
    html.match(/value=['"]([^'"]+)['"][^>]*name=['"]csrfmiddlewaretoken['"]/i);
  return m ? m[1] : "";
}

export class DjangoAdminSession {
  private jar: Record<string, string> = {};
  private loggedIn = false;
  readonly adminBase = NKB_BETA_ADMIN_URL;

  private resolveUrl(pathOrUrl: string): string {
    const raw = String(pathOrUrl || "").trim();
    if (!raw) return this.adminBase;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/")) return `${new URL(this.adminBase).origin}${raw}`;
    return new URL(raw, this.adminBase).href;
  }

  private async request(
    url: string,
    init: RequestInit = {},
    depth = 0,
  ): Promise<{ status: number; text: string }> {
    const cookie = Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const res = await fetch(url, {
      method: init.method || "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.headers || {}),
      },
      body: init.body,
      redirect: "manual",
    });

    for (const line of parseSetCookie(res)) {
      const pair = line.split(";")[0].trim();
      const eq = pair.indexOf("=");
      if (eq > 0) this.jar[pair.slice(0, eq)] = pair.slice(eq + 1);
    }

    const text = await res.text().catch(() => "");
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location && depth < 5) {
      return this.request(this.resolveUrl(location), {}, depth + 1);
    }
    return { status: res.status, text };
  }

  async ensureLoggedIn(): Promise<void> {
    if (this.loggedIn) return;
    const { username, password } = djangoAdminCredentials();
    if (!username || !password) {
      throw new Error(
        "DJANGO_ADMIN_USERNAME and DJANGO_ADMIN_PASSWORD are required to look up question sets.",
      );
    }

    const loginUrl = this.resolveUrl("login/");
    const page = await this.request(loginUrl);
    const csrf = extractCsrf(page.text) || this.jar.csrftoken || "";
    if (!csrf) throw new Error("Could not read CSRF token from the Django admin login page.");

    await this.request(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: loginUrl },
      body: new URLSearchParams({
        csrfmiddlewaretoken: csrf,
        username,
        password,
        next: this.adminBase,
      }).toString(),
    });

    if (!this.jar.sessionid) {
      throw new Error(
        "Django admin login failed (no session cookie) — check DJANGO_ADMIN_USERNAME / DJANGO_ADMIN_PASSWORD.",
      );
    }
    this.loggedIn = true;
  }

  async fetchHtml(pathOrUrl: string): Promise<string> {
    await this.ensureLoggedIn();
    const { status, text } = await this.request(this.resolveUrl(pathOrUrl));
    if (status === 403) throw new Error(`403 Forbidden loading admin page: ${pathOrUrl}`);
    return text;
  }
}

/** Narrow the page to the changelist table so unrelated markup cannot match. */
export function extractResultListSection(html: string): string {
  const m = html.match(/<table[^>]*\bid=['"]result_list['"][^>]*>([\s\S]*?)<\/table>/i);
  return m ? m[1] : html;
}
