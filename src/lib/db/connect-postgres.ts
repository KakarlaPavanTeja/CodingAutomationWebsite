import { existsSync } from "node:fs";
import postgres from "postgres";

function defaultSocketDir(): string {
  if (process.platform === "win32") return "";
  for (const dir of ["/var/run/postgresql", "/tmp"]) {
    if (existsSync(dir)) return dir;
  }
  return "/var/run/postgresql";
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

// Pool size defaults to 10. Override with PG_POOL_MAX to run a second app
// instance (e.g. a worktree dev server) against the same DB without exhausting
// its connection slots.
function poolMax(): number {
  const n = Number(process.env.PG_POOL_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

// Tags every connection so pg_stat_activity / pg_stat_statements can tell app
// traffic apart from Hex, scripts/db.mts and the one-off backfill scripts.
const APP_NAME = "cp-prep-app";

export function createPostgresClient(connectionString: string) {
  const socket = parseSocketUrl(connectionString);
  if (socket) {
    return postgres({
      host: socket.host,
      database: socket.database,
      username: socket.username,
      max: poolMax(),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      connection: { application_name: APP_NAME },
    });
  }
  return postgres(connectionString, {
    max: poolMax(),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    connection: { application_name: APP_NAME },
  });
}
