"use client";

import { useSyncExternalStore } from "react";
import { onThemeChange, readThemeChoice, setThemeChoice, type ThemeChoice } from "@/lib/theme";

const NEXT: Record<ThemeChoice, ThemeChoice> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<ThemeChoice, string> = { auto: "Auto (follows phone)", light: "Light", dark: "Dark" };

// One button that cycles Auto → Light → Dark. The icon shows the current choice.
export function ThemeToggle() {
  // "auto" while rendering on the server; the phone's saved choice once in the browser.
  const current = useSyncExternalStore(onThemeChange, readThemeChoice, () => "auto" as const);
  return (
    <button
      type="button"
      onClick={() => {
        setThemeChoice(NEXT[current]);
      }}
      aria-label={`Colours: ${LABEL[current]}. Tap to change.`}
      title={`Colours: ${LABEL[current]}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-stone-300 text-stone-700"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        {current === "light" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : current === "dark" ? (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
          </>
        )}
      </svg>
    </button>
  );
}
