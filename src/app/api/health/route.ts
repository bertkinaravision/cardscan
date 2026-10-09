import { allowedEmails, cleanEnv, driveUploadMode } from "@/lib/server/env";

export const dynamic = "force-dynamic";

// Setup check: which settings this deployment can see. Secrets are reported as set/missing only;
// the Google client ID is public anyway (it appears in every sign-in link).
export function GET() {
  const set = (name: string) => (process.env[name]?.trim() ? "set" : "MISSING");
  const clientId = cleanEnv(process.env.AUTH_GOOGLE_ID) ?? "";
  let serviceAccount = "MISSING";
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    try {
      const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const key = JSON.parse(json) as { client_email?: string; private_key?: string };
      serviceAccount = key.client_email && key.private_key ? `ok (${key.client_email})` : "set, but not a service account key file";
    } catch {
      serviceAccount = "set, but not valid JSON";
    }
  }
  return Response.json(
    {
      deployment: process.env.VERCEL_ENV ?? "local",
      AUTH_SECRET: set("AUTH_SECRET"),
      AUTH_GOOGLE_ID: clientId || "MISSING",
      AUTH_GOOGLE_ID_looks_valid: /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId),
      AUTH_GOOGLE_SECRET: set("AUTH_GOOGLE_SECRET"),
      ALLOWED_EMAILS: `${allowedEmails().length} address(es)`,
      GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccount,
      SHEET_ID: process.env.SHEET_ID?.trim() || "MISSING",
      DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID?.trim() || "MISSING",
      DRIVE_UPLOAD_MODE: driveUploadMode(),
      LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini (default)",
      GEMINI_API_KEY: set("GEMINI_API_KEY"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
