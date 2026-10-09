import Image from "next/image";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "@/auth";
import { isAllowed } from "@/lib/server/env";

export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const session = await auth();
  // Only allowlisted people go on to the app; anyone else would bounce between here and "/".
  const signedInButNotAllowed = !!session?.user && !isAllowed(session.user.email);
  if (session?.user && !signedInButNotAllowed) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div className="flex flex-col items-center text-center">
        <Image src="/kinara-logo.png" alt="Kinara Vision Technologies" width={220} height={134} priority className="mb-8" />
        <h1 className="text-3xl font-semibold text-brand">CardScan</h1>
        <p className="mt-2 text-stone-600">Scan business cards into the shared contact sheet.</p>
      </div>
      {(error || signedInButNotAllowed) && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error === "AccessDenied" || signedInButNotAllowed
            ? "This Google account is not allowed to use CardScan."
            : "Sign-in failed. Please try again."}
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
          <button className="w-full rounded-xl bg-brand px-4 py-3 text-lg font-medium text-white active:bg-brand-dark">
            Sign in with Google
          </button>
        </form>
      )}
    </main>
  );
}
