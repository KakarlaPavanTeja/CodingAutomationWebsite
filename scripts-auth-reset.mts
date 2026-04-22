import { createPasswordResetToken } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

const BASE = "http://localhost:5000";
const email = `resetsmoke_${Date.now()}@test.local`;
const pw1 = "OriginalPw123!";
const pw2 = "NewBetterPw456!";

// Sign up via API
let res = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email, password: pw1, displayName: "Reset Smoke", role: "admin",
    adminSecret: process.env.ADMIN_SECRET_KEY,
  }),
});
console.log("signup:", res.status);

// Mint a reset token directly
const token = await createPasswordResetToken(email);
console.log("token minted:", !!token);

// Confirm via API
res = await fetch(`${BASE}/api/auth/reset-password/confirm`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token, password: pw2 }),
});
console.log("reset-confirm:", res.status, await res.json());

// Login with new password
res = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pw2 }),
});
console.log("login-new-pw:", res.status, await res.json());

// Login with old password — should fail
res = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: pw1 }),
});
console.log("login-old-pw (should 401):", res.status, await res.json());

// Cleanup
await db.delete(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
console.log("cleaned up");
process.exit(0);
