import "server-only";
import { getToken } from "next-auth/jwt";
import { auth } from "@/auth";
import { driveUploadMode, isAllowed, requireEnv } from "./env";

export type ApiUser = { email: string; name: string; googleAccessToken: string | null };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// For route handlers: returns the signed-in, allowlisted user, or throws 401/403.
export async function requireUser(req: Request): Promise<ApiUser> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new HttpError(401, "Not signed in.");
  if (!isAllowed(email)) throw new HttpError(403, "This Google account is not on the allowlist.");
  const name = session.user?.name?.split(" ")[0] || email.split("@")[0];
  const googleAccessToken = driveUploadMode() === "user" ? await userAccessToken(req) : null;
  return { email, name, googleAccessToken };
}

// Refreshed tokens can't be written back into the session cookie from an API route, so keep them
// in memory for their lifetime instead of asking Google again on every request.
const refreshed = new Map<string, { token: string; expiresAt: number }>();

// Reads the person's Google token from the session cookie and refreshes it if it has expired.
async function userAccessToken(req: Request): Promise<string | null> {
  const token = await getToken({
    req,
    secret: requireEnv("AUTH_SECRET"),
    secureCookie: new URL(req.url).protocol === "https:",
  });
  if (!token?.googleAccessToken) return null;
  const expiresAt = (token.googleExpiresAt ?? 0) * 1000;
  if (Date.now() < expiresAt - 60_000) return token.googleAccessToken;
  if (!token.googleRefreshToken) return null;
  const cached = refreshed.get(token.googleRefreshToken);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: requireEnv("AUTH_GOOGLE_ID"),
      client_secret: requireEnv("AUTH_GOOGLE_SECRET"),
      grant_type: "refresh_token",
      refresh_token: token.googleRefreshToken,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;
  refreshed.set(token.googleRefreshToken, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return Response.json({ error: message }, { status: 500 });
}
