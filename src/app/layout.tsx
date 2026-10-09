import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import { applyThemeScript, THEME_COLORS } from "@/lib/theme";
import "./globals.css";

const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat" });

export const metadata: Metadata = {
  title: "CardScan",
  description: "Scan business cards into the shared contact sheet",
  appleWebApp: { capable: true, title: "CardScan", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-theme is set by the script below before React loads, so React must not complain about it.
    <html lang="en" className={`${montserrat.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyThemeScript }} />
      </head>
      <body className="min-h-full bg-stone-50 font-sans text-ink">{children}</body>
    </html>
  );
}
