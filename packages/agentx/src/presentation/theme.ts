export type Tone = "pass" | "warn" | "fail" | "preview" | "neutral";

export const ICONS: Record<Tone, string> = {
  pass: "✓",
  warn: "⚠",
  fail: "✗",
  preview: "→",
  neutral: "•",
};

export const LABELS: Record<Tone, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  preview: "PREVIEW",
  neutral: "RUN",
};

export const INK_COLORS: Record<Tone, string> = {
  pass: "green",
  warn: "yellow",
  fail: "red",
  preview: "cyan",
  neutral: "blue",
};

export const HELP_CATEGORY_COLORS: Record<string, string> = {
  Core: "green",
  Inspect: "cyan",
  Sync: "blue",
  Setup: "magenta",
  Extensions: "yellow",
  Telemetry: "gray",
  Legacy: "gray",
};

export const INDENT = "  ";
export const STATUS_LABEL_WIDTH = 5;
export const SECTION_GAP = "";
