// Palette from the approved Figma library, detail, and source states.
export const figmaColors = {
  canvas: "#0b0b10",
  surface: "#15151c",
  raised: "#22202b",
  inset: "#302a36",
  border: "#433a48",
  primary: "#f7f3f0",
  secondary: "#ada9b5",
  tertiary: "#96919d",
  rose: "#ee91a3",
  gold: "#e9b777",
  onRose: "#24151c",
} as const;

export function formatFigmaTime(seconds: number): string {
  const value = Math.floor(Math.max(0, seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
