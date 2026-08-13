import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  numeric,
  boolean,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordResetRequired: boolean("password_reset_required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
  }),
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("password_reset_tokens_user_idx").on(t.userId),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expIdx: index("sessions_expires_idx").on(t.expiresAt),
  }),
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name"),
    role: text("role").notNull().default("problem_setter"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    roleCheck: check("profiles_role_check", sql`${t.role} IN ('admin','problem_setter')`),
    statusCheck: check(
      "profiles_status_check",
      sql`${t.status} IN ('active','left','pending_approval','deactivated')`,
    ),
  }),
);

export const problems = pgTable(
  "problems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdBy: uuid("created_by").notNull().references(() => profiles.id),
    name: text("name").notNull(),
    questionType: text("question_type").notNull(),
    structureType: text("structure_type").notNull().default("standard"),
    mode: text("mode").notNull(),
    scenarioLevel: text("scenario_level").notNull().default("none"),
    difficulty: text("difficulty"),
    score: integer("score"),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("draft"),
    storagePath: text("storage_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    deletionReason: text("deletion_reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    modeCheck: check("problems_mode_check", sql`${t.mode} IN ('practice','exam')`),
    questionTypeCheck: check(
      "problems_question_type_check",
      sql`${t.questionType} IN ('function','nonfunction')`,
    ),
    structureTypeCheck: check(
      "problems_structure_type_check",
      sql`${t.structureType} IN ('standard','linked_list','binary_tree')`,
    ),
    scenarioCheck: check(
      "problems_scenario_level_check",
      sql`${t.scenarioLevel} IN ('none','light','moderate','heavy')`,
    ),
    difficultyCheck: check(
      "problems_difficulty_check",
      sql`${t.difficulty} IS NULL OR ${t.difficulty} IN ('easy','medium','hard')`,
    ),
    scoreCheck: check(
      "problems_score_check",
      sql`${t.score} IS NULL OR (${t.score} >= 1 AND ${t.score} <= 100000)`,
    ),
    statusCheck: check(
      "problems_status_check",
      sql`${t.status} IN ('draft','partial','processing','completed','failed','deletion_pending','deleted')`,
    ),
  }),
);

export const problemAccess = pgTable(
  "problem_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    problemMemberIdx: uniqueIndex("problem_access_problem_member_idx").on(
      t.problemId,
      t.memberId,
    ),
    problemIdx: index("problem_access_problem_idx").on(t.problemId),
    memberIdx: index("problem_access_member_idx").on(t.memberId),
  }),
);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id),
    stepId: text("step_id").notNull(),
    status: text("status").notNull().default("running"),
    exitCode: integer("exit_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    logsSummary: text("logs_summary"),
    pid: integer("pid"),
  },
  (t) => ({
    statusCheck: check(
      "pipeline_runs_status_check",
      sql`${t.status} IN ('running','completed','failed')`,
    ),
  }),
);

export const pipelineStates = pgTable("pipeline_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  problemId: uuid("problem_id")
    .notNull()
    .unique()
    .references(() => problems.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => profiles.id),
  questionType: text("question_type").notNull().default("function"),
  mode: text("mode").notNull().default("practice"),
  enabledLanguages: text("enabled_languages")
    .array()
    .default(sql`'{Python,C++,Java,Node.js}'::text[]`),
  // No default: unset means "let the pipeline scale the suite by difficulty".
  testcaseCount: integer("testcase_count"),
  stepConfigs: jsonb("step_configs").default(sql`'{}'::jsonb`),
  stepStatuses: jsonb("step_statuses").default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// Tiny global key/value store for app-wide settings (e.g. which OpenRouter
// account key is active). One row per setting.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// pipeline_logs is gone: step logs live in object storage under
// {problemId}/logs/{stepId}.log and {problemId}/logs/runs/{stepId}/{runId}.log.
// A multi-MB TOASTed text column rewritten on every sync tick filled the
// database disk — see docs/postgres-operations.md.

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    problemId: uuid("problem_id").references(() => problems.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => profiles.id),
    model: text("model").notNull(),
    purpose: text("purpose").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    problemName: text("problem_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    stepId: text("step_id"),
    // Exact pipeline run this usage belongs to (P1-M1). Nullable: legacy rows and
    // non-pipeline calls have none, and those fall back to time-window matching.
    runId: uuid("run_id"),
    // Which OpenRouter account key produced this call ("new" | "old"). Legacy
    // rows predate the key switch and were all on the single (new) key.
    account: text("account").notNull().default("new"),
  },
  (t) => ({
    createdAtIdx: index("idx_llm_usage_created_at").on(sql`${t.createdAt} DESC`),
    modelIdx: index("idx_llm_usage_model").on(t.model),
    problemIdx: index("idx_llm_usage_problem_id").on(t.problemId),
    userIdx: index("idx_llm_usage_user_id").on(t.userId),
    runIdx: index("idx_llm_usage_run_id").on(t.runId),
  }),
);

export const authAuditLog = pgTable(
  "auth_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    eventIdx: index("idx_audit_event").on(t.eventType, sql`${t.createdAt} DESC`),
    userIdx: index("idx_audit_user").on(t.userId, sql`${t.createdAt} DESC`),
  }),
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    attemptCount: integer("attempt_count").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    resetAtIdx: index("idx_rate_limits_reset_at").on(t.resetAt),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Problem = typeof problems.$inferSelect;
export type NewProblem = typeof problems.$inferInsert;
export type ProblemAccess = typeof problemAccess.$inferSelect;
export type NewProblemAccess = typeof problemAccess.$inferInsert;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type PipelineState = typeof pipelineStates.$inferSelect;
export type LlmUsage = typeof llmUsage.$inferSelect;
export type AuthAuditLog = typeof authAuditLog.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
