import { DISPLAY } from "./brand.js";
import type { RitualFinishedJsonEvent, RitualKind, RitualProgressEvent, RitualProgressSummary } from "./ritual-progress.js";
import type { RitualViewModel } from "./ritual-view-model.js";

type WriteLine = (line: string) => void;

const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const MAX_LOG_TEXT = 220;

function compactText(value: unknown): string | undefined {
  const text = typeof value === "string"
    ? value
      .replace(ANSI_ESCAPE_PATTERN, "")
      .replace(/\r/g, "\n")
      .split(/\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
    : "";
  if (!text) return undefined;
  return text.length > MAX_LOG_TEXT ? `${text.slice(0, MAX_LOG_TEXT - 3).trimEnd()}...` : text;
}

function cleanLabel(label: string): string {
  return label.trim().replace(/[.]+$/, "");
}

function prefixForStatus(status: RitualProgressEvent["status"]): string | undefined {
  if (status === "queued") return undefined;
  if (status === "running") return "Running";
  if (status === "pass") return "Finished";
  if (status === "warn") return "Warning";
  if (status === "fail") return "Error";
  return "Skipped";
}

function startVerb(kind: RitualKind): string {
  if (kind === "install") return "Installing";
  if (kind === "update") return "Updating";
  if (kind === "reset") return "Resetting";
  return "Checking";
}

function finalSuffix(statusLabel: string | undefined): string {
  const label = statusLabel?.toLowerCase();
  if (!label || label === "pass") return "";
  if (label === "warn") return " with warnings";
  if (label === "fail") return " with errors";
  if (label === "preview") return " preview";
  return ` (${label})`;
}

export function formatRitualStartLine(kind: RitualKind, subtitle?: string): string {
  const target = compactText(subtitle);
  return target ? `${startVerb(kind)} ${DISPLAY} for ${target}` : `${startVerb(kind)} ${DISPLAY}`;
}

export function formatRitualProgressLine(event: RitualProgressEvent): string | undefined {
  const prefix = prefixForStatus(event.status);
  if (!prefix) return undefined;
  const message = compactText(event.message);
  return message
    ? `${prefix.padStart(9)} ${cleanLabel(event.label)}: ${message}`
    : `${prefix.padStart(9)} ${cleanLabel(event.label)}`;
}

export function formatRitualFinishedLine(kind: RitualKind, summary?: RitualProgressSummary | RitualViewModel): string {
  return ` Finished ${DISPLAY} ${kind}${finalSuffix(summary?.statusLabel)}`;
}

export class RitualLogPrinter {
  constructor(
    private readonly kind: RitualKind,
    private readonly writeLine: WriteLine = (line) => console.log(line),
  ) {}

  start(subtitle?: string): void {
    this.writeLine(formatRitualStartLine(this.kind, subtitle));
  }

  step(event: RitualProgressEvent): void {
    const line = formatRitualProgressLine(event);
    if (line) this.writeLine(line);
  }

  finish(summary?: RitualProgressSummary | RitualViewModel, files: string[] = []): void {
    this.writeLine(formatRitualFinishedLine(this.kind, summary));
    for (const callout of summary?.callouts ?? []) {
      const text = compactText(callout);
      if (text) this.writeLine(`     Note ${text}`);
    }
    for (const next of summary?.next ?? []) {
      const text = compactText(next);
      if (text) this.writeLine(`     Next ${text}`);
    }
    for (const file of files) {
      const text = compactText(file);
      if (text) this.writeLine(`   Report ${text}`);
    }
  }

  finishFromProgress(event: RitualFinishedJsonEvent): void {
    this.finish(event.summary, event.files ?? []);
  }

  error(error: unknown, summary?: RitualProgressSummary): void {
    const message = compactText(error instanceof Error ? error.message : String(error)) ?? "Unknown error.";
    this.writeLine(`    Error ${message}`);
    this.finish({ statusLabel: "FAIL", callouts: summary?.callouts, next: summary?.next }, []);
  }
}
