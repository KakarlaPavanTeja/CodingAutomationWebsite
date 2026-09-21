import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOpenRouterKeyUsage } from "./openrouter-key-usage";

test("parses /key and /credits into one shape", () => {
  const out = parseOpenRouterKeyUsage(
    {
      data: {
        label: "sk-or-v1-abc",
        usage: 12.5,
        usage_daily: 1,
        usage_weekly: 4,
        usage_monthly: 12.5,
        limit: 100,
        limit_remaining: 87.5,
        is_free_tier: false,
      },
    },
    { data: { total_credits: 200, total_usage: 150.25 } }
  );
  assert.deepEqual(out, {
    label: "sk-or-v1-abc",
    usage: 12.5,
    usageDaily: 1,
    usageWeekly: 4,
    usageMonthly: 12.5,
    limit: 100,
    limitRemaining: 87.5,
    isFreeTier: false,
    totalCredits: 200,
    totalUsage: 150.25,
  });
});

test("tolerates a missing endpoint and null limits", () => {
  const out = parseOpenRouterKeyUsage({ data: { usage: 3, limit: null } }, null);
  assert.equal(out.usage, 3);
  assert.equal(out.limit, null);
  assert.equal(out.limitRemaining, null);
  assert.equal(out.totalCredits, null);
});
