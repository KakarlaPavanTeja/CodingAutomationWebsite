import { existsSync } from "node:fs";
import postgres from "postgres";

export function resolveDatabaseUrl(url: string): string {
  const m = url.match(/^postgres(ql)?:\/\/\/([^?/]+)$/);
  if (!m) return url;
  const db = m[2];
  const user = process.env.USER ?? process.env.USERNAME ?? "postgres";
  const socketDir = defaultSocketDir();
  return `postgresql://${encodeURIComponent(user)}@localhost/${db}?host=${encodeURIComponent(socketDir)}`;
}

export function defaultSocketDir(): string {
  if (process.platform === "win32") return "";
  for (const dir of ["/var/run/postgresql", "/tmp"]) {
    if (existsSync(dir)) return dir;
  }
  return "/var/run/postgresql";
}

/** Use object options for unix sockets — URL ?host= breaks some postgres.js queries. */
export function connectPostgres(
  url: string,
  extra: postgres.Options<Record<string, never>> = {},
) {
  const resolved = resolveDatabaseUrl(url);
  const socket = parseSocketUrl(resolved);
  if (socket) {
    return postgres({
      host: socket.host,
      database: socket.database,
      username: socket.username,
      max: 1,
      prepare: false,
      ssl: false,
      ...extra,
    });
  }
  const opts: postgres.Options<Record<string, never>> = {
    max: 1,
    prepare: false,
    ...extra,
  };
  if (isLocalTcp(resolved)) opts.ssl = false;
  return postgres(resolved, opts);
}

function parseSocketUrl(url: string): { host: string; database: string; username: string } | null {
  const triple = url.match(/^postgres(ql)?:\/\/\/([^?/]+)$/);
  if (triple) {
    return {
      host: defaultSocketDir(),
      database: triple[2],
      username: process.env.USER ?? process.env.USERNAME ?? "postgres",
    };
  }
  const m = url.match(/^postgres(ql)?:\/\/([^@]*)@localhost\/([^?]+)\?host=([^&]+)/);
  if (m) {
    return {
      username: decodeURIComponent(m[2] || process.env.USER || "postgres"),
      database: m[3],
      host: decodeURIComponent(m[4]),
    };
  }
  return null;
}

function isLocalTcp(url: string): boolean {
  try {
    const host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
    return ["localhost", "127.0.0.1", "::1", ""].includes(host);
  } catch {
    return false;
  }
}
