import "server-only";
import { Readable } from "node:stream";
import { drive as driveApi } from "@googleapis/drive";
import { auth, sheets as sheetsApi } from "@googleapis/sheets";
import { driveUploadMode, requireEnv } from "./env";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

// GOOGLE_SERVICE_ACCOUNT_JSON holds the service account key file, pasted as-is
// (or base64-encoded, if your host mangles multi-line values).
function serviceAccountAuth() {
  const raw = requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON").trim();
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const key = JSON.parse(json) as { client_email: string; private_key: string };
  return new auth.JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES });
}

export function sheetsClient() {
  return sheetsApi({ version: "v4", auth: serviceAccountAuth() });
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
  const res = await drive.files.create({
    requestBody: { name, parents: [requireEnv("DRIVE_FOLDER_ID")], mimeType: "image/jpeg" },
    media: { mimeType: "image/jpeg", body: Readable.from(data) },
    fields: "id,webViewLink",
    supportsAllDrives: true,
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
