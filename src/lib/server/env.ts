import "server-only";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See README.md → Environment variables.`);
  return value;
}

// Values pasted into Vercel sometimes pick up quotes, spaces or line breaks (Google Cloud shows the
// client ID wrapped over two lines, and copying it can include the break); Google then answers
// "invalid_client". For values that never contain whitespace, remove it all instead of failing.
export const cleanEnv = (v: string | undefined) => v?.replace(/\s+/g, "").replace(/^["']+|["']+$/g, "") || undefined;

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

// OWNERS: the people contacts can be assigned to, comma-separated ("Bert,Preeti"). Shown as a
// dropdown in the app and the Sheet; empty means owner is free text.
export function owners(): string[] {
  return [...new Set((process.env.OWNERS ?? "").split(",").map((o) => o.trim()).filter(Boolean))];
}

// The owner preselected for someone signing in: the OWNERS entry matching their first name.
export function ownerFor(name: string | null | undefined): string {
  const first = (name ?? "").split(" ")[0].toLowerCase();
  const list = owners();
  if (list.length === 0) return (name ?? "").split(" ")[0];
  return list.find((o) => o.toLowerCase() === first) ?? "";
}
