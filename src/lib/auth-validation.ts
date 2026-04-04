export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too weak" | "Weak" | "Fair" | "Good" | "Strong";
  errors: string[];
};

export function validatePassword(password: string): PasswordStrength {
  const errors: string[] = [];
  let score = 0;

  if (password.length < 8) {
    errors.push("At least 8 characters");
  } else {
    score++;
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    errors.push("Upper and lowercase letters");
  } else {
    score++;
  }

  if (!/\d/.test(password)) {
    errors.push("At least one number");
  } else {
    score++;
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push("At least one special character");
  } else {
    score++;
  }

  const labels: Record<number, PasswordStrength["label"]> = {
    0: "Too weak",
    1: "Weak",
    2: "Fair",
    3: "Good",
    4: "Strong",
  };

  return {
    score: score as PasswordStrength["score"],
    label: labels[score],
    errors,
  };
}

export function validateEmail(email: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const normalized = email.trim().toLowerCase();

  if (!normalized) {
    return { valid: false, normalized, error: "Email is required." };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    return { valid: false, normalized, error: "Please enter a valid email." };
  }

  return { valid: true, normalized };
}

export function validateDisplayName(name: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  // Strip HTML tags
  const sanitized = name.trim().replace(/<[^>]*>/g, "");

  if (sanitized.length < 2) {
    return {
      valid: false,
      sanitized,
      error: "Name must be at least 2 characters.",
    };
  }

  if (sanitized.length > 50) {
    return {
      valid: false,
      sanitized: sanitized.slice(0, 50),
      error: "Name must be 50 characters or less.",
    };
  }

  return { valid: true, sanitized };
}

const ERROR_MAP: Record<string, string> = {
  "Invalid login credentials": "Incorrect email or password.",
  "Email not confirmed": "Please verify your email before signing in.",
  "User already registered": "An account with this email already exists.",
  "Signup requires a valid password":
    "Please enter a valid password (at least 6 characters).",
  "Password should be at least 6 characters":
    "Password must be at least 8 characters.",
  "Email rate limit exceeded":
    "Too many attempts. Please try again in a few minutes.",
  "For security purposes, you can only request this once every 60 seconds":
    "Please wait 60 seconds before requesting another email.",
  "New password should be different from the old password.":
    "Your new password must be different from the current one.",
};

export function sanitizeErrorMessage(error: unknown): string {
  if (!error) return "Something went wrong. Please try again.";

  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : String(error);

  // Check exact matches
  if (ERROR_MAP[message]) return ERROR_MAP[message];

  // Check partial matches
  for (const [key, friendly] of Object.entries(ERROR_MAP)) {
    if (message.toLowerCase().includes(key.toLowerCase())) return friendly;
  }

  // Don't expose internal errors
  if (
    message.includes("duplicate key") ||
    message.includes("violates") ||
    message.includes("constraint") ||
    message.includes("relation") ||
    message.includes("column")
  ) {
    return "Something went wrong. Please try again.";
  }

  return message;
}
