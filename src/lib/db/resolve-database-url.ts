import { existsSync } from "node:fs";

/**
 * `postgresql:///dbname` is psql shorthand for a unix socket. The `postgres` npm
 * package treats an empty host as TCP localhost instead, which triggers password
 * auth failures when no password is configured.
 */
export function resolveDatabaseUrl(url: string): string {
  const m = url.match(/^postgres(ql)?:\/\/\/([^?/]+)$/);
  if (!m) return url;

  const db = m[2];
  const user = process.env.USER ?? process.env.USERNAME ?? "postgres";
  const socketDir = defaultSocketDir();
  // localhost is required for URL parsing; ?host= overrides to the unix socket dir.
  return `postgresql://${encodeURIComponent(user)}@localhost/${db}?host=${encodeURIComponent(socketDir)}`;
}

function defaultSocketDir(): string {
  if (process.platform === "win32") return "";
  for (const dir of ["/var/run/postgresql", "/tmp"]) {
    if (existsSync(dir)) return dir;
  }
  return "/var/run/postgresql";
}
