// Light / dark mode. "auto" follows the phone's setting. The choice is kept on this phone only.
export type ThemeChoice = "auto" | "light" | "dark";
export const THEME_KEY = "cardscan:theme";
export const THEME_COLORS = { light: "#ffffff", dark: "#1d1b19" } as const;

// Runs in <head> before the page paints (no flash of the wrong colours). Also used by the toggle,
// so both apply a choice the same way: sets <html data-theme> and the browser bar colour.
export const applyThemeScript = `(function(){
  var colors = ${JSON.stringify(THEME_COLORS)};
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function choice(){ try { return localStorage.getItem("${THEME_KEY}") || "auto"; } catch (e) { return "auto"; } }
  function apply(){
    var c = choice();
    var theme = c === "light" || c === "dark" ? c : (media.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){ m.setAttribute("content", colors[theme]); });
  }
  window.__cardscanApplyTheme = apply;
  if (media.addEventListener) media.addEventListener("change", apply);
  window.addEventListener("storage", apply);
  apply();
})();`;

const CHANGED = "cardscan:theme-changed";
let fallback: ThemeChoice | null = null; // used when storage is blocked (private mode)

export function readThemeChoice(): ThemeChoice {
  if (fallback) return fallback;
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function onThemeChange(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", fn); // changed in another tab
  return () => {
    window.removeEventListener(CHANGED, fn);
    window.removeEventListener("storage", fn);
  };
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
    fallback = null;
  } catch {
    // Storage blocked (private mode): the choice still applies until the page is reloaded.
    fallback = choice;
    document.documentElement.dataset.theme =
      choice === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : choice;
    window.dispatchEvent(new Event(CHANGED));
    return;
  }
  (window as unknown as { __cardscanApplyTheme?: () => void }).__cardscanApplyTheme?.();
  window.dispatchEvent(new Event(CHANGED));
}
