import fs from "node:fs";
import { runNativeCommand } from "./native-runner.js";

export interface ClearReadOnlyDirectoryResult {
  status: "skipped" | "cleared" | "failed";
  message: string;
  output?: string;
}

export function windowsAttribOutputHasReadOnly(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => /\bR\b/.test(line.slice(0, 24)));
}

function resultText(result: { error?: string; stdout?: string; stderr?: string }): string {
  return [result.error, result.stderr, result.stdout].filter(Boolean).join("\n").trim();
}

export function clearWindowsReadOnlyDirectoryAttribute(
  dir: string,
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
  },
): ClearReadOnlyDirectoryResult {
  if ((options.platform ?? process.platform) !== "win32") {
    return { status: "skipped", message: "Not running on Windows." };
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { status: "skipped", message: "Directory is not present." };
  }

  const inspect = runNativeCommand({
    command: "attrib",
    args: [dir],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 15000,
    env: { ...process.env, ...options.env },
  });
  const inspectText = resultText(inspect);
  if (inspect.error || inspect.status !== 0) {
    return {
      status: "failed",
      message: `Could not inspect Windows directory attributes for ${dir}: ${inspectText || "attrib failed"}`,
      output: inspectText,
    };
  }
  if (!windowsAttribOutputHasReadOnly(inspectText)) {
    return { status: "skipped", message: "Directory is not read-only.", output: inspectText };
  }

  const cleared = runNativeCommand({
    command: "attrib",
    args: ["-R", dir],
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 15000,
    env: { ...process.env, ...options.env },
  });
  const clearText = resultText(cleared);
  if (cleared.error || cleared.status !== 0) {
    return {
      status: "failed",
      message: `Could not clear Windows read-only attribute for ${dir}: ${clearText || "attrib -R failed"}`,
      output: clearText,
    };
  }
  return {
    status: "cleared",
    message: `Cleared Windows read-only attribute from ${dir}.`,
    output: clearText || inspectText,
  };
}
