import { ICONS, INDENT, type Tone } from "./theme.js";

export function statusRow(tone: Tone, label: string, detail?: string): string {
  const trailing = detail ? `  ${detail}` : "";
  return `${INDENT}${ICONS[tone]} ${label}${trailing}`;
}

export function sectionHeader(title: string): string {
  return `\n${title}`;
}

export function kvRow(key: string, value: string, keyWidth = 12): string {
  const paddedKey = key.length >= keyWidth ? key : key.padEnd(keyWidth, " ");
  return `${INDENT}${paddedKey}${value}`;
}

export function bulletList(items: readonly string[]): string[] {
  return items.map((item) => `${INDENT}${ICONS.neutral} ${item}`);
}

export function padToColumn(rows: ReadonlyArray<readonly string[]>): string[] {
  if (rows.length === 0) return [];
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths: number[] = [];
  for (let col = 0; col < columnCount; col += 1) {
    let max = 0;
    for (const row of rows) {
      const cell = row[col] ?? "";
      if (cell.length > max) max = cell.length;
    }
    widths.push(max);
  }
  return rows.map((row) => row.map((cell, col) => (col === columnCount - 1 ? cell : cell.padEnd(widths[col], " "))).join("  "));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0).replace(/\.0$/, "")}s`;
}

export function printError(message: string): void {
  process.stderr.write(`${ICONS.fail} ${message}\n`);
}

export function printNotice(message: string): void {
  process.stdout.write(`${ICONS.preview} ${message}\n`);
}
