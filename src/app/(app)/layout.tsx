import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { NavLinks } from "@/components/NavLinks";
import { QueueRunner } from "@/components/QueueRunner";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SignOutButton } from "@/components/SignOutButton";
import { isAllowed } from "@/lib/server/env";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  if (!session?.user?.email || !isAllowed(session.user.email)) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="hidden text-lg font-semibold text-brand min-[400px]:block">
          CardScan
        </Link>
        <NavLinks />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
          className="flex items-center text-sm"
        >
          <SignOutButton email={session.user.email} />
        </form>
      </header>
      <QueueRunner />
      <ServiceWorker />
      <div className="flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+6rem)]">{children}</div>
    </div>
  );
}
