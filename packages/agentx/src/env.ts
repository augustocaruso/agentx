const WARNED_LEGACY_NAMES = new Set<string>();

function warnLegacyName(name: string, replacement: string): void {
  if (WARNED_LEGACY_NAMES.has(name)) return;
  WARNED_LEGACY_NAMES.add(name);
  try {
    process.stderr.write(`warning: env var ${name} is deprecated; use ${replacement} instead.\n`);
  } catch {
    // Ignore broken pipes — the warning is non-essential.
  }
}

export function readEnvAgentx(suffix: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const canonical = `AGENTX_${suffix}`;
  const fromNew = env[canonical];
  if (fromNew !== undefined) return fromNew;

  const legacy = `OGB_${suffix}`;
  const fromLegacy = env[legacy];
  if (fromLegacy === undefined) return undefined;

  warnLegacyName(legacy, canonical);
  return fromLegacy;
}

export function resetLegacyEnvWarningsForTesting(): void {
  WARNED_LEGACY_NAMES.clear();
}
