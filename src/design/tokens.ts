// Entry and capture stay white; seasonal color belongs to completed memories.
export const colors = {
  paper: "#ffffff",
  ink: "#202321",
  muted: "#676d69",
  line: "#dce1dd",
  quiet: "#f3f5f3",
  memoryInk: "#202321",
  memoryMuted: "#676d69",
  memoryAccent: "#4c6558",
  memoryPaper: "#ffffff",
} as const;

// Images carry the color; controls and typography share one graphite palette.
export const radii = { window: 24, surface: 14, control: 32 } as const;

export const layout = {
  pageWidth: 520,
  inset: 24,
} as const;
