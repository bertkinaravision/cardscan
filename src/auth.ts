import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { driveUploadMode, isAllowed } from "@/lib/server/env";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

// Values pasted into Vercel sometimes pick up quotes, spaces or a line break; Google then
// answers "invalid_client". Clean them up instead of failing.
const clean = (v: string | undefined) => v?.trim().replace(/^["']|["']$/g, "").trim() || undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: clean(process.env.AUTH_GOOGLE_ID),
      clientSecret: clean(process.env.AUTH_GOOGLE_SECRET),
      authorization: {
        params:
          driveUploadMode() === "user"
            ? // Test phase: images are uploaded as the signed-in person, so ask for Drive
              // access and a refresh token.
              { scope: `openid email profile ${DRIVE_SCOPE}`, access_type: "offline", prompt: "consent" }
            : { scope: "openid email profile", prompt: "select_account" },
      },
    }),
  ],
  pages: { signIn: "/signin", error: "/signin" },
  session: { maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    signIn({ profile }) {
      return profile?.email_verified === true && isAllowed(profile.email);
    },
    // Google tokens stay in the encrypted session cookie and are never sent to the browser.
    jwt({ token, account }) {
      if (account) {
        token.googleAccessToken = account.access_token;
        token.googleRefreshToken = account.refresh_token;
        token.googleExpiresAt = account.expires_at;
      }
      return token;
    },
  },
});

declare module "next-auth/jwt" {
  interface JWT {
    googleAccessToken?: string;
    googleRefreshToken?: string;
    googleExpiresAt?: number;
  }
}
