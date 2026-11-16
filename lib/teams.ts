export const TEAM_COLOURS: Record<string, string> = {
  mercedes: "#27F4D2",
  red_bull: "#3671C6",
  ferrari: "#E8002D",
  mclaren: "#FF8000",
  rb: "#6692FF",
  racing_bulls: "#6692FF",
  alphatauri: "#6692FF",
  toro_rosso: "#6692FF",
  alpine: "#FF87BC",
  haas: "#B6BABD",
  audi: "#00E701",
  sauber: "#00E701",
  kick_sauber: "#00E701",
  aston_martin: "#229971",
  williams: "#64C4FF",
  cadillac: "#D4AF37",
};

const TEAM_NAMES: Record<string, string> = {
  red_bull: "Red Bull",
  rb: "Racing Bulls",
  racing_bulls: "Racing Bulls",
  aston_martin: "Aston Martin",
  audi: "Audi",
  sauber: "Audi",
  kick_sauber: "Audi",
  mercedes: "Mercedes",
  ferrari: "Ferrari",
  mclaren: "McLaren",
  alpine: "Alpine",
  haas: "Haas",
  williams: "Williams",
  cadillac: "Cadillac",
};

export function teamColour(id: string | undefined): string {
  if (!id) return "#8A8A93";
  return TEAM_COLOURS[id] ?? "#8A8A93";
}

export function teamName(id: string | undefined, fallback?: string): string {
  if (!id) return fallback ?? "—";
  return TEAM_NAMES[id] ?? fallback ?? id;
}

export function teamShort(id: string | undefined): string {
  const name = teamName(id);
  return name.length > 12 ? name.slice(0, 11) + "…" : name;
}
