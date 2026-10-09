import "server-only";
import { Readable } from "node:stream";
import { drive as driveApi } from "@googleapis/drive";
import { auth, sheets as sheetsApi } from "@googleapis/sheets";
import type { GaxiosError, RetryConfig } from "gaxios";
import { driveUploadMode, requireEnv } from "./env";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

// GOOGLE_SERVICE_ACCOUNT_JSON holds the service account key file, pasted as-is
// (or base64-encoded, if your host mangles multi-line values).
function serviceAccountKey(): { client_email: string; private_key: string } {
  const raw = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON").trim();
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the whole key file.");
  }
}

function serviceAccountAuth() {
  const key = serviceAccountKey();
  return new auth.JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
}

// Turns Google's API errors into setup hints a person can act on.
export function explainGoogleError(err: unknown, what: "sheet" | "drive"): Error {
  const e = err as { code?: number; status?: number; message?: string };
  const code = e.code ?? e.status;
  const msg = e.message ?? "";
  if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
    return new Error(`The Google ${what === "sheet" ? "Sheets" : "Drive"} API is not enabled in your Cloud project. Enable it under APIs & Services → Library.`);
  }
  if (what === "sheet") {
    const who = (() => {
      try {
        return serviceAccountKey().client_email;
      } catch {
        return "the service account";
      }
    })();
    if (code === 403) return new Error(`The service account can't open the Sheet. Share the Sheet with ${who} as Editor.`);
    if (code === 404) return new Error("Sheet not found. Check SHEET_ID (the part between /d/ and /edit in the Sheet's URL).");
    if (typeof code === "number" && code >= 500) return new Error("Google Sheets isn't responding right now. Try again in a minute.");
  } else {
    if (code === 403 && /insufficient|scope/i.test(msg))
      return new Error("CardScan has no Google Drive access. Sign out, sign in again, and tick the Google Drive box on Google's screen.");
    if (code === 403 || code === 404)
      return new Error(
        driveUploadMode() === "user"
          ? "The image folder can't be found or isn't shared with you. Check DRIVE_FOLDER_ID and the folder's sharing."
          : "The service account can't reach the image folder. Check DRIVE_FOLDER_ID and add the service account to the shared drive as Content manager.",
      );
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Google answers 429 when a batch of saves goes over the per-minute quota (about 60 requests):
// wait and retry 2s, 4s, 8s, 16s (30s in all, so the minute can roll over). A 5xx is retried
// twice (2s, 4s); if Google is still failing it is likely down for a while, so say so quickly.
// Writes (POST) are retried only on 429, where Google guarantees nothing was written; requests that
// were cancelled are never retried.
const MAX_RETRIES = 4;
const attemptOf = (err: GaxiosError) => err.config?.retryConfig?.currentRetryAttempt ?? 0;
const retryConfig: RetryConfig = {
  retry: MAX_RETRIES,
  httpMethodsToRetry: ["GET", "PUT", "POST", "DELETE"],
  shouldRetry: (err) => {
    if (err.name === "AbortError" || err.code === "ABORT_ERR") return false;
    const attempt = attemptOf(err);
    if (attempt >= MAX_RETRIES) return false;
    const status = err.response?.status;
    if (status === 429) return true;
    if ((err.config?.method ?? "GET").toUpperCase() === "POST") return false;
    if (status === undefined) return attempt < 2; // no answer at all: try twice
    return status >= 500 && attempt < 2;
  },
  retryBackoff: (err) => new Promise<void>((r) => setTimeout(r, 2000 * 2 ** attemptOf(err))),
};

export function sheetsClient() {
  return sheetsApi({ version: "v4", auth: serviceAccountAuth(), retryConfig });
}

// Drive client for card images. In "user" mode it acts as the signed-in person.
export function driveClient(userAccessToken: string | null) {
  if (driveUploadMode() === "service_account") {
    return driveApi({ version: "v3", auth: serviceAccountAuth() });
  }
  if (!userAccessToken) {
    throw new Error("Google Drive access has expired. Sign out and sign in again.");
  }
  const client = new auth.OAuth2();
  client.setCredentials({ access_token: userAccessToken });
  return driveApi({ version: "v3", auth: client });
}

export async function uploadImage(
  userAccessToken: string | null,
  name: string,
  data: Buffer,
): Promise<{ id: string; link: string }> {
  const drive = driveClient(userAccessToken);
  const res = await drive.files
    .create({
      requestBody: { name, parents: [requireEnv("DRIVE_FOLDER_ID")], mimeType: "image/jpeg" },
      media: { mimeType: "image/jpeg", body: Readable.from(data) },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    })
    .catch((err) => {
      throw explainGoogleError(err, "drive");
    });
  return { id: res.data.id!, link: res.data.webViewLink ?? `https://drive.google.com/file/d/${res.data.id}/view` };
}

// Returns the IDs that could not be deleted (for example, files someone else owns in a personal Drive).
export async function deleteImages(userAccessToken: string | null, ids: string[]): Promise<string[]> {
  const drive = driveClient(userAccessToken);
  const failed: string[] = [];
  for (const fileId of ids) {
    try {
      await drive.files.delete({ fileId, supportsAllDrives: true });
    } catch (err) {
      const status = (err as { code?: number }).code;
      if (status !== 404) failed.push(fileId);
    }
  }
  return failed;
}
