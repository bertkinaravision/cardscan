import "server-only";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See README.md → Environment variables.`);
  return value;
}

// Values pasted into Vercel sometimes pick up quotes, spaces or a line break; Google then
// answers "invalid_client". Clean them up instead of failing.
export const cleanEnv = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "").trim() || undefined;

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined): boolean {
  return !!email && allowedEmails().includes(email.toLowerCase());
}

// "user": upload card images with the signed-in person's Google login (personal accounts, test phase).
// "service_account": upload with the service account (Workspace shared drive).
export function driveUploadMode(): "user" | "service_account" {
  return process.env.DRIVE_UPLOAD_MODE === "service_account" ? "service_account" : "user";
}
