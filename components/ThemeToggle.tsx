"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/**
 * Theme switch. The stored choice lives on <html data-theme>; the inline script
 * in the layout applies it before first paint so there is no flash, and this
 * component only mirrors that state for the button.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("bp-theme", next);
    } catch {
      /* private mode: the choice just will not persist */
    }
  };

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <span className="theme-dot" aria-hidden="true" />
      <span className="mono theme-label">{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
