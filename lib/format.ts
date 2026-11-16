const FLAGS: Record<string, string> = {
  British: "🇬🇧",
  Dutch: "🇳🇱",
  Italian: "🇮🇹",
  Spanish: "🇪🇸",
  Monegasque: "🇲🇨",
  French: "🇫🇷",
  German: "🇩🇪",
  Australian: "🇦🇺",
  Mexican: "🇲🇽",
  Canadian: "🇨🇦",
  Japanese: "🇯🇵",
  Thai: "🇹🇭",
  Danish: "🇩🇰",
  Finnish: "🇫🇮",
  Brazilian: "🇧🇷",
  Argentine: "🇦🇷",
  "Argentinian": "🇦🇷",
  Chinese: "🇨🇳",
  American: "🇺🇸",
  "New Zealander": "🇳🇿",
  Austrian: "🇦🇹",
  Belgian: "🇧🇪",
  Swiss: "🇨🇭",
  Polish: "🇵🇱",
  Russian: "🇷🇺",
  Swedish: "🇸🇪",
};

export function flag(nationality: string | undefined): string {
  if (!nationality) return "";
  return FLAGS[nationality] ?? "🏁";
}

export function initials(given: string, family: string): string {
  return `${given.charAt(0)}${family.charAt(0)}`.toUpperCase();
}

export function fmtLap(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export function fmtGap(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const sign = seconds >= 0 ? "+" : "−";
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

export function timeAgo(input: string | Date): string {
  const then = typeof input === "string" ? new Date(input) : input;
  const diff = Date.now() - then.getTime();
  if (!Number.isFinite(diff)) return "";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days}d ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function raceDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function raceWeekday(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short" });
}

export function daysUntil(date: string): number {
  const target = new Date(`${date}T12:00:00Z`).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / 86400000);
}

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
