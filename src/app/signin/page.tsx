import Image from "next/image";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/auth";
import { isAllowed } from "@/lib/server/env";

// Auth.js error codes, with what usually causes them.
const ERROR_HINTS: Record<string, string> = {
  AccessDenied: "This Google account is not allowed to use CardScan.",
  Configuration:
    "Server setup problem. Check AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET in Vercel, then redeploy (new variables only apply after a redeploy). Vercel's logs show the exact cause.",
  OAuthSignin: "Could not start Google sign-in. Check AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET.",
  OAuthCallback:
    "Google sent you back but the login could not be completed. Check AUTH_GOOGLE_SECRET and that the redirect URI in Google Cloud matches this site exactly.",
  Verification: "The sign-in link expired. Please try again.",
};

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const session = await auth();
  // Only allowlisted people go on to the app; anyone else would bounce between here and "/".
  const signedInButNotAllowed = !!session?.user && !isAllowed(session.user.email);
  if (session?.user && !signedInButNotAllowed) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center text-center">
        {/* The logo is drawn in dark pencil, so it sits on its own white panel (readable in dark mode too). */}
        <div className="mb-8 rounded-2xl bg-[#ffffff] p-3">
          <Image src="/kinara-logo.png" alt="Kinara Vision Technologies" width={220} height={134} priority />
        </div>
        <h1 className="text-3xl font-semibold text-brand">CardScan</h1>
        <p className="mt-2 text-stone-600">Scan business cards into the shared contact sheet.</p>
      </div>
      {(error || signedInButNotAllowed) && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {signedInButNotAllowed
            ? ERROR_HINTS.AccessDenied
            : ((Object.hasOwn(ERROR_HINTS, String(error)) && ERROR_HINTS[String(error)]) || "Sign-in failed. Please try again.")}
          {error && error !== "AccessDenied" && (
            <span className="mt-1 block text-sm text-red-700/80">Error code: {String(error)}</span>
          )}
        </p>
      )}
      {signedInButNotAllowed ? (
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button className="w-full rounded-xl border border-stone-300 px-4 py-3 text-lg font-medium text-stone-700">
            Sign out of {session.user?.email}
          </button>
        </form>
      ) : (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button className="w-full rounded-xl bg-brand-dark px-4 py-3 text-lg font-medium text-on-accent active:bg-brand-darker">
            Sign in with Google
          </button>
        </form>
      )}
    </main>
  );
}
