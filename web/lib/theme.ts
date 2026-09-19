/**
 * Light or dark. Light is the default for everyone; dark is opt-in from the navbar toggle and remembered per browser.
 * The choice is stored in localStorage and applied as <html data-theme="dark"> before the first paint (THEME_SCRIPT),
 * so a dark-mode reader never sees a light flash.
 */
export type Theme = "light" | "dark";

export const THEME_KEY = "linkr-theme";

/** Inlined in <head>: runs before the page paints. */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export function currentTheme(): Theme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Switches the page's theme and remembers it. */
export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") root.dataset.theme = "dark";
  else delete root.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the switch still applies to this visit.
  }
}
