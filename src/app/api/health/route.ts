import { allowedEmails, cleanEnv, driveUploadMode } from "@/lib/server/env";

export const dynamic = "force-dynamic";

// Setup check: which settings this deployment can see. Secrets are reported as set/missing only;
// the Google client ID is public anyway (it appears in every sign-in link).
// The README's example values, which are easy to paste by mistake.
const EXAMPLES = ["(random)", "123-abc.apps.googleusercontent.com", "GOCSPX-...", "1AbC...", "1XyZ...", "AIza...", "sk-ant-...", "bert@gmail.com", "preeti@gmail.com", '{"type":"service_account",...}'];
const isExample = (v: string | undefined) => !!v && EXAMPLES.some((e) => v.replace(/\s+/g, "").includes(e.replace(/\s+/g, "")));

export function GET() {
  const set = (name: string) =>
    isExample(process.env[name]) ? "EXAMPLE VALUE: replace with your own" : process.env[name]?.trim() ? "set" : "MISSING";
  const clientId = cleanEnv(process.env.AUTH_GOOGLE_ID) ?? "";
  let serviceAccount = "MISSING";
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw && isExample(raw)) {
    serviceAccount = "EXAMPLE VALUE: paste the whole key file";
  } else if (raw) {
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
      AUTH_GOOGLE_ID: isExample(clientId) ? `EXAMPLE VALUE (${clientId}): replace with your own` : clientId || "MISSING",
      AUTH_GOOGLE_ID_looks_valid: !isExample(clientId) && /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId),
      AUTH_GOOGLE_SECRET: set("AUTH_GOOGLE_SECRET"),
      ALLOWED_EMAILS: isExample(process.env.ALLOWED_EMAILS)
        ? "EXAMPLE VALUE: use your real Gmail addresses"
        : `${allowedEmails().length} address(es)`,
      GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccount,
      SHEET_ID: isExample(process.env.SHEET_ID) ? "EXAMPLE VALUE: replace with your Sheet ID" : process.env.SHEET_ID?.trim() || "MISSING",
      DRIVE_FOLDER_ID: isExample(process.env.DRIVE_FOLDER_ID)
        ? "EXAMPLE VALUE: replace with your folder ID"
        : process.env.DRIVE_FOLDER_ID?.trim() || "MISSING",
      DRIVE_UPLOAD_MODE: driveUploadMode(),
      LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini (default)",
      GEMINI_API_KEY: set("GEMINI_API_KEY"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
