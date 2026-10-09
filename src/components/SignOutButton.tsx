"use client";

import { clearQueue, listCardInfo } from "@/lib/client/queue";

// Asks first (the button sits next to the tabs and is easy to hit), warns about cards not yet in
// the Sheet, then clears the queue, photos and offline copy so the next person on this phone sees nothing.
export function SignOutButton({ email }: { email: string }) {
  return (
    <button
      title={`Signed in as ${email}`}
      onClick={async (e) => {
        e.preventDefault();
        const form = e.currentTarget.form;
        const unsaved = (await listCardInfo().catch(() => [])).filter((c) => c.status !== "saved").length;
        const question =
          unsaved > 0
            ? `Sign out? ${unsaved} card${unsaved > 1 ? "s" : ""} on this phone ${unsaved > 1 ? "are" : "is"} not saved to the Sheet yet and will be deleted from the phone.`
            : `Sign out of CardScan (${email})?`;
        if (!confirm(question)) return;
        await clearQueue().catch(() => {});
        if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k))).catch(() => {});
        form?.requestSubmit();
      }}
      className="rounded-lg border border-stone-300 px-2 py-1 text-stone-700"
    >
      Sign out
    </button>
  );
}
