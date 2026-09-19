"use client";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "@phosphor-icons/react/ssr";
import { currentTheme, setTheme, type Theme } from "@/lib/theme";

/** Re-renders whenever <html data-theme> changes, whoever changed it (another toggle, say). */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/**
 * Switches between light and dark. Where the browser supports view transitions the new theme spreads out from the
 * button as a circle; otherwise, or with reduced motion, it switches at once. Either way no element's own colour
 * transition runs, so nothing flickers through half-way colours.
 */
function switchTheme(next: Theme, from: HTMLElement) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document.startViewTransition !== "function") {
    setTheme(next);
    done();
    return;
  }
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-r", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
  document.startViewTransition(() => setTheme(next)).finished.finally(done);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, currentTheme, (): Theme => "light");
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      aria-label={label}
      title={label}
      onClick={(e) => switchTheme(next, e.currentTarget)}
    >
      <span className="theme-toggle-icon" data-shown={theme === "light"} aria-hidden="true">
        <Moon size={18} weight="regular" />
      </span>
      <span className="theme-toggle-icon" data-shown={theme === "dark"} aria-hidden="true">
        <Sun size={18} weight="regular" />
      </span>
    </button>
  );
}
