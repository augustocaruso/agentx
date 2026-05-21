import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";

function cmdQuote(value: string): string {
  const escaped = value
    .replace(/"/g, '""')
    .replace(/\^/g, "^^")
    .replace(/%/g, "^%");
  return `"${escaped}"`;
}

export function normalizeCommandInput(value: string): string {
  let normalized = String(value).trim();
  let changed = true;
  while (changed && normalized.length >= 2) {
    changed = false;
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (normalized.length >= 4) {
      const escapedFirst = normalized.slice(0, 2);
      const escapedLast = normalized.slice(-2);
      if ((escapedFirst === "\\\"" && escapedLast === "\\\"") || (escapedFirst === "\\'" && escapedLast === "\\'")) {
        normalized = normalized.slice(2, -2).trim();
        changed = true;
      }
    }
  }
  return normalized;
}

interface PlatformCommand {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

function cmdToken(value: string, command = false): string {
  if (command && /^[A-Za-z0-9_.-]+$/.test(value)) return value;
  if (!command && /^[A-Za-z0-9_./:@+=-]+$/.test(value)) return value;
  return cmdQuote(value);
}

export function commandForPlatform(command: string, args: readonly string[] = [], platform: NodeJS.Platform = process.platform): PlatformCommand {
  const normalizedCommand = normalizeCommandInput(command);
  if (platform !== "win32") return { command: normalizedCommand, args: [...args] };

  const ext = normalizedCommand.split(/[\\/]/).pop()?.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (ext === ".exe") return { command: normalizedCommand, args: [...args] };

  const comspec = process.env.ComSpec || "cmd.exe";
  const innerCommandLine = [cmdToken(normalizedCommand, true), ...args.map((arg) => cmdToken(arg))].join(" ");
  const commandLine = `"${innerCommandLine}"`;
  return {
    command: comspec,
    args: ["/d", "/s", "/c", commandLine],
    windowsVerbatimArguments: true,
  };
}

function spawnOptions<T extends SpawnOptions | SpawnSyncOptions>(options: T, normalized: PlatformCommand): T {
  const withoutShellOptions = withoutShell(options) as T & { windowsVerbatimArguments?: boolean };
  if (normalized.windowsVerbatimArguments) withoutShellOptions.windowsVerbatimArguments = true;
  return withoutShellOptions as T;
}

function withoutShell<T extends SpawnOptions | SpawnSyncOptions>(options: T): T {
  const normalized = { ...options };
  delete normalized.shell;
  return normalized;
}

export function spawnCommand(command: string, args: readonly string[] = [], options: SpawnOptions = {}): ChildProcess {
  const normalized = commandForPlatform(command, args);
  return spawn(normalized.command, normalized.args, spawnOptions(options, normalized));
}

export function spawnCommandSync(command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
export function spawnCommandSync(command: string, args?: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<Buffer>;
export function spawnCommandSync(command: string, args: readonly string[] = [], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  const normalized = commandForPlatform(command, args);
  return spawnSync(normalized.command, normalized.args, spawnOptions(options, normalized));
}
