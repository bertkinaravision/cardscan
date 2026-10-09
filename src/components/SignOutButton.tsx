"use client";

// Clears the offline copy of the app before signing out, so the next person on this phone sees nothing.
export function SignOutButton({ email }: { email: string }) {
  return (
    <button
      title={`Signed in as ${email}`}
      onClick={() => {
        if ("caches" in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
      }}
      className="rounded-lg border border-stone-300 px-2 py-1 text-stone-700"
    >
      Sign out
    </button>
  );
}
