"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Scan", match: (p: string) => p === "/" || p.startsWith("/review") },
  { href: "/contacts", label: "Contacts", match: (p: string) => p.startsWith("/contacts") },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${l.match(pathname) ? "bg-brand text-white" : "text-stone-600"}`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
