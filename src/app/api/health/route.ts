import { auth } from "@/auth";
import { allowedEmails, cleanEnv, driveUploadMode, isAllowed } from "@/lib/server/env";

export const dynamic = "force-dynamic";

// Setup check: which settings this deployment can see. Secrets are reported as set/missing only;
// the Google client ID is public anyway (it appears in every sign-in link).
// The README's example values, which are easy to paste by mistake.
const EXAMPLES = [
  "(random)",
  "123-abc.apps.googleusercontent.com",
  "GOCSPX-...",
  "1AbC...",
  "1XyZ...",
  "AIza...",
  "sk-ant-...",
  "bert@gmail.com",
  "preeti@gmail.com",
  '{"type":"service_account",...}',
];
const isExample = (v: string | undefined) =>
  !!v && EXAMPLES.some((e) => v.replace(/\s+/g, "").includes(e.replace(/\s+/g, "")));

// Checks that each configured Gemini model exists for this key (a free metadata lookup).
async function geminiModels(): Promise<Record<string, string> | string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if ((process.env.LLM_PROVIDER || "gemini").toLowerCase() !== "gemini") return "not used";
  if (!key) return "no GEMINI_API_KEY";
  const models = [
    process.env.LLM_MODEL || "gemini-3.5-flash-lite",
    ...(process.env.LLM_FALLBACK_MODELS ?? "gemini-3.1-flash-lite,gemini-3.5-flash").split(","),
  ]
    .map((m) => m.trim())
    .filter(Boolean);
  const out: Record<string, string> = {};
  for (const m of [...new Set(models)]) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}`, {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(5000),
      });
      out[m] = res.ok ? "ok" : res.status === 404 ? "NOT FOUND (retired or misspelled)" : `error ${res.status}`;
    } catch {
      out[m] = "could not check";
    }
  }
  return out;
}

export async function GET() {
  const set = (name: string) =>
    isExample(process.env[name])
      ? "EXAMPLE VALUE: replace with your own"
      : process.env[name]?.trim()
        ? "set"
        : "MISSING";
  const clientId = cleanEnv(process.env.AUTH_GOOGLE_ID) ?? "";
  let serviceAccount = "MISSING";
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw && isExample(raw)) {
    serviceAccount = "EXAMPLE VALUE: paste the whole key file";
  } else if (raw) {
    try {
      const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const key = JSON.parse(json) as { client_email?: string; private_key?: string };
      serviceAccount =
        key.client_email && key.private_key ? `ok (${key.client_email})` : "set, but not a service account key file";
    } catch {
      serviceAccount = "set, but not valid JSON";
    }
  }
  // Anyone may see whether each setting is present (needed while sign-in itself is being fixed);
  // the IDs, the service account and the model check are shown only to a signed-in, allowed user.
  const session = await auth().catch(() => null);
  const full = isAllowed(session?.user?.email);
  const hidden = "(sign in to see)";
  const sheetId = isExample(process.env.SHEET_ID)
    ? "EXAMPLE VALUE: replace with your Sheet ID"
    : process.env.SHEET_ID?.trim()
      ? full
        ? process.env.SHEET_ID.trim()
        : "set"
      : "MISSING";
  const folderId = isExample(process.env.DRIVE_FOLDER_ID)
    ? "EXAMPLE VALUE: replace with your folder ID"
    : process.env.DRIVE_FOLDER_ID?.trim()
      ? full
        ? process.env.DRIVE_FOLDER_ID.trim()
        : "set"
      : "MISSING";
  return Response.json(
    {
      deployment: process.env.VERCEL_ENV ?? "local",
      details: full ? "full" : "limited: sign in to CardScan to see IDs and model checks",
      AUTH_SECRET: set("AUTH_SECRET"),
      AUTH_GOOGLE_ID: isExample(clientId)
        ? `EXAMPLE VALUE (${clientId}): replace with your own`
        : clientId || "MISSING",
      AUTH_GOOGLE_ID_looks_valid:
        !isExample(clientId) && /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId),
      AUTH_GOOGLE_SECRET: set("AUTH_GOOGLE_SECRET"),
      ALLOWED_EMAILS: isExample(process.env.ALLOWED_EMAILS)
        ? "EXAMPLE VALUE: use your real Gmail addresses"
        : `${allowedEmails().length} address(es)`,
      GOOGLE_SERVICE_ACCOUNT_JSON: full || !serviceAccount.startsWith("ok") ? serviceAccount : "ok",
      SHEET_ID: sheetId,
      DRIVE_FOLDER_ID: folderId,
      DRIVE_UPLOAD_MODE: driveUploadMode(),
      LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini (default)",
      GEMINI_API_KEY: set("GEMINI_API_KEY"),
      gemini_models: full ? await geminiModels() : hidden,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
