import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { QueueRunner } from "@/components/QueueRunner";
import { isAllowed } from "@/lib/server/env";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  if (!session?.user?.email || !isAllowed(session.user.email)) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-semibold text-brand">
          CardScan
        </Link>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
          className="flex items-center gap-3 text-sm text-stone-500"
        >
          <span className="hidden max-w-40 truncate min-[380px]:inline">{session.user.email}</span>
          <button className="rounded-lg border border-stone-300 px-2 py-1 text-stone-700">Sign out</button>
        </form>
      </header>
      <QueueRunner />
      <div className="flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+6rem)]">{children}</div>
    </div>
  );
}
