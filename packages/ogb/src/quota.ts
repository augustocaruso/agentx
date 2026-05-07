import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveProjectPaths } from "./paths.js";
import { OGB_VERSION } from "./types.js";

// Gemini Code Assist quota compatibility layer.
// The flow mirrors the MIT-licensed opencode-gemini-auth plugin's /gquota path:
// https://github.com/jenslys/opencode-gemini-auth
// OGB keeps this isolated from the TUI so the sidebar only renders a safe cache file.
const GEMINI_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const GEMINI_CLI_VERSION = "0.42.0-nightly.20260428.g59b2dea0e";
const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000;
const DEFAULT_CACHE_TTL_MS = 60_000;

export interface QuotaOptions {
  projectRoot?: string;
  homeDir?: string;
  force?: boolean;
  write?: boolean;
  ttlMs?: number;
}

export interface QuotaBucketSummary {
  modelId: string;
  variant: string;
  tokenType: string;
  remainingPercent?: number;
  usedPercent?: number;
  resetTime?: string;
  resetIn?: string;
  remainingAmount?: string;
}

export interface QuotaSummary {
  label: string;
  usedPercent?: number;
  remainingPercent?: number;
  resetTime?: string;
  resetIn?: string;
  modelId?: string;
}

export interface QuotaReport {
  version: string;
  projectRoot: string;
  generatedAt: string;
  status: "ok" | "unavailable" | "error";
  projectId?: string;
  summary: QuotaSummary;
  buckets: QuotaBucketSummary[];
  message?: string;
  source: {
    name: "opencode-gemini-auth-compatible";
    manualCommand: "/gquota";
    upstream: "https://github.com/jenslys/opencode-gemini-auth";
    license: "MIT";
  };
}

interface OpenCodeAuthFile {
  google?: OAuthAuthRecord;
  [key: string]: unknown;
}

interface OAuthAuthRecord {
  type?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  [key: string]: unknown;
}

interface RefreshParts {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
}

interface OAuthClient {
  id: string;
  secret: string;
  source: string;
}

interface RetrieveUserQuotaBucket {
  remainingAmount?: string;
  remainingFraction?: number;
  resetTime?: string;
  tokenType?: string;
  modelId?: string;
}

interface RetrieveUserQuotaResponse {
  buckets?: RetrieveUserQuotaBucket[];
}

function sourceInfo(): QuotaReport["source"] {
  return {
    name: "opencode-gemini-auth-compatible",
    manualCommand: "/gquota",
    upstream: "https://github.com/jenslys/opencode-gemini-auth",
    license: "MIT",
  };
}

function authPath(homeDir: string): string {
  return path.join(homeDir, ".local", "share", "opencode", "auth.json");
}

function readJson(filePath: string): any | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function readText(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cachedReport(filePath: string, ttlMs: number): QuotaReport | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const stat = fs.statSync(filePath);
  if (Date.now() - stat.mtimeMs > ttlMs) return undefined;
  const parsed = readJson(filePath);
  if (!parsed || typeof parsed !== "object") return undefined;
  if (parsed.status !== "ok" && parsed.status !== "unavailable" && parsed.status !== "error") return undefined;
  return parsed as QuotaReport;
}

export function parseRefreshParts(refresh: string | undefined): RefreshParts {
  const [refreshToken = "", projectId = "", managedProjectId = ""] = (refresh ?? "").split("|");
  return {
    refreshToken,
    projectId: projectId || undefined,
    managedProjectId: managedProjectId || undefined,
  };
}

function accessTokenExpired(auth: OAuthAuthRecord): boolean {
  return !auth.access || typeof auth.expires !== "number" || auth.expires <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS;
}

function buildGeminiCliUserAgent(): string {
  return `GeminiCLI/${GEMINI_CLI_VERSION}/gemini-code-assist (${process.platform}; ${process.arch}; terminal)`;
}

function extractExportedString(text: string | undefined, name: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*["']([^"']+)["']`));
  return match?.[1];
}

function pluginPackageDirs(homeDir: string, packageName: string): string[] {
  const packagesDir = path.join(homeDir, ".cache", "opencode", "packages");
  const dirs = new Set<string>([
    path.join(packagesDir, `${packageName}@latest`),
  ]);
  try {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith(`${packageName}@`)) {
        dirs.add(path.join(packagesDir, entry.name));
      }
    }
  } catch {
    // Missing OpenCode package cache is a normal unauthenticated state.
  }
  return [...dirs];
}

function geminiAuthPackageDirs(homeDir: string): string[] {
  return pluginPackageDirs(homeDir, "opencode-gemini-auth");
}

function antigravityAuthPackageDirs(homeDir: string): string[] {
  return pluginPackageDirs(homeDir, "opencode-google-antigravity-auth");
}

function clientFromConstantsFile(filePath: string, idName: string, secretName: string): OAuthClient | undefined {
  const text = readText(filePath);
  const id = extractExportedString(text, idName);
  const secret = extractExportedString(text, secretName);
  if (!id || !secret) return undefined;
  return { id, secret, source: filePath };
}

function geminiOAuthClientsFromPlugin(homeDir: string): OAuthClient[] {
  const candidates = geminiAuthPackageDirs(homeDir).flatMap((dir) => [
    path.join(dir, "node_modules", "opencode-gemini-auth", "src", "constants.ts"),
    path.join(dir, "node_modules", "opencode-gemini-auth", "dist", "constants.js"),
  ]);
  return candidates
    .map((filePath) => clientFromConstantsFile(filePath, "GEMINI_CLIENT_ID", "GEMINI_CLIENT_SECRET"))
    .filter((client): client is OAuthClient => Boolean(client));
}

function antigravityOAuthClientsFromPlugin(homeDir: string): OAuthClient[] {
  const candidates = antigravityAuthPackageDirs(homeDir).flatMap((dir) => [
    path.join(dir, "node_modules", "opencode-google-antigravity-auth", "src", "constants.ts"),
    path.join(dir, "node_modules", "opencode-google-antigravity-auth", "dist", "constants.js"),
  ]);
  return candidates
    .map((filePath) => clientFromConstantsFile(filePath, "ANTIGRAVITY_CLIENT_ID", "ANTIGRAVITY_CLIENT_SECRET"))
    .filter((client): client is OAuthClient => Boolean(client));
}

function uniqueOAuthClients(clients: OAuthClient[]): OAuthClient[] {
  const seen = new Set<string>();
  const unique: OAuthClient[] = [];
  for (const client of clients) {
    const key = `${client.id}\0${client.secret}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(client);
  }
  return unique;
}

function geminiOAuthClients(homeDir: string): OAuthClient[] {
  const clients: OAuthClient[] = [];
  const id = process.env.OGB_GEMINI_CLIENT_ID || process.env.GEMINI_OAUTH_CLIENT_ID;
  const secret = process.env.OGB_GEMINI_CLIENT_SECRET || process.env.GEMINI_OAUTH_CLIENT_SECRET;
  if (id && secret) clients.push({ id, secret, source: "environment" });
  clients.push(...geminiOAuthClientsFromPlugin(homeDir));
  clients.push(...antigravityOAuthClientsFromPlugin(homeDir));
  return uniqueOAuthClients(clients);
}

function parseOAuthErrorPayload(text: string | undefined): { code?: string; description?: string } {
  if (!text) return {};
  try {
    const payload = JSON.parse(text) as {
      error?: string | { code?: string; status?: string; message?: string };
      error_description?: string;
    };
    if (!payload || typeof payload !== "object") return { description: text };
    if (typeof payload.error === "string") {
      return { code: payload.error, description: payload.error_description };
    }
    if (payload.error && typeof payload.error === "object") {
      return {
        code: payload.error.status ?? payload.error.code,
        description: payload.error_description ?? payload.error.message,
      };
    }
    return { description: payload.error_description };
  } catch {
    return { description: text };
  }
}

async function responseErrorMessage(prefix: string, response: Response): Promise<string> {
  let text: string | undefined;
  try {
    text = await response.clone().text();
  } catch {
    text = undefined;
  }
  const parsed = parseOAuthErrorPayload(text);
  const details = [parsed.code, parsed.description ?? text].filter(Boolean).join(": ");
  return `${prefix} HTTP ${response.status}${details ? ` - ${details}` : ""}`;
}

function isLikelyGoogleProjectId(value: string | undefined): value is string {
  if (!value) return false;
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
}

function usableProjectId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return isLikelyGoogleProjectId(trimmed) ? trimmed : undefined;
}

async function requestAccessToken(refreshToken: string, client: OAuthClient): Promise<{ access_token?: string; expires_in?: number; refresh_token?: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.id,
      client_secret: client.secret,
    }),
  });

  if (!response.ok) throw new Error(await responseErrorMessage(`Google OAuth refresh via ${client.source}`, response));
  return await response.json() as { access_token?: string; expires_in?: number; refresh_token?: string };
}

async function refreshAccessToken(auth: OAuthAuthRecord, homeDir: string): Promise<{ auth?: OAuthAuthRecord; message?: string }> {
  const parts = parseRefreshParts(auth.refresh);
  if (!parts.refreshToken) return { message: "Google OAuth sem refresh_token salvo. Refaca opencode auth login." };

  const clients = geminiOAuthClients(homeDir);
  if (clients.length === 0) {
    return { message: "Cliente OAuth Google indisponivel nos plugins do OpenCode. Reinstale ou reautentique o provider Google." };
  }

  const errors: string[] = [];
  for (const client of clients) {
    try {
      const payload = await requestAccessToken(parts.refreshToken, client);
      if (!payload.access_token) {
        errors.push(`Google OAuth refresh via ${client.source} returned no access_token`);
        continue;
      }

      const authFile = readJson(authPath(homeDir)) as OpenCodeAuthFile | undefined;
      const nextParts = {
        refreshToken: payload.refresh_token ?? parts.refreshToken,
        projectId: parts.projectId,
        managedProjectId: parts.managedProjectId,
      };
      const updated: OAuthAuthRecord = {
        ...auth,
        access: payload.access_token,
        expires: Date.now() + Math.max(1, Number(payload.expires_in ?? 3600)) * 1000,
        refresh: [nextParts.refreshToken, nextParts.projectId ?? "", nextParts.managedProjectId ?? ""].join("|"),
      };
      writeJson(authPath(homeDir), { ...(authFile ?? {}), google: updated });
      return { auth: updated };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    message: `Google OAuth refresh falhou: ${errors.join("; ")}. Refaca opencode auth login para gerar um refresh token novo.`,
  };
}

async function resolveAuth(options: { homeDir: string }): Promise<{ accessToken?: string; projectId?: string; message?: string }> {
  const authFile = readJson(authPath(options.homeDir)) as OpenCodeAuthFile | undefined;
  const auth = authFile?.google;
  if (!auth || auth.type !== "oauth") {
    return { message: "Google OAuth do OpenCode nao encontrado. Use /gquota depois de autenticar." };
  }

  const parts = parseRefreshParts(auth.refresh);
  const projectId = usableProjectId(parts.managedProjectId)
    ?? usableProjectId(parts.projectId)
    ?? usableProjectId(process.env.OPENCODE_GEMINI_PROJECT_ID)
    ?? usableProjectId(process.env.GOOGLE_CLOUD_PROJECT);
  const refreshed = accessTokenExpired(auth) ? await refreshAccessToken(auth, options.homeDir) : { auth };
  const accessToken = refreshed.auth?.access;
  if (!accessToken) {
    return { projectId, message: refreshed.message ?? "Token Google indisponivel. Rode /gquota ou refaca opencode auth login." };
  }

  return { accessToken, projectId };
}

async function retrieveUserQuota(accessToken: string, projectId: string): Promise<RetrieveUserQuotaResponse | undefined> {
  const response = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:retrieveUserQuota`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": buildGeminiCliUserAgent(),
      "x-activity-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({ project: projectId }),
  });
  if (!response.ok) throw new Error(await responseErrorMessage("Gemini Code Assist quota", response));
  return await response.json() as RetrieveUserQuotaResponse;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentLabel(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function resetIn(resetTime: string | undefined): string | undefined {
  if (!resetTime) return undefined;
  const resetAt = new Date(resetTime).getTime();
  if (Number.isNaN(resetAt)) return undefined;
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) return "now";
  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function splitModelVariant(modelId: string): { modelId: string; variant: string } {
  const vertexSuffix = "_vertex";
  if (modelId.endsWith(vertexSuffix)) {
    return { modelId: modelId.slice(0, -vertexSuffix.length), variant: "vertex" };
  }
  return { modelId, variant: "default" };
}

export function summarizeQuotaBuckets(buckets: RetrieveUserQuotaBucket[]): { summary: QuotaSummary; buckets: QuotaBucketSummary[] } {
  const normalized = buckets.map((bucket) => {
    const model = splitModelVariant(bucket.modelId?.trim() || "unknown-model");
    const remainingPercent = typeof bucket.remainingFraction === "number" && Number.isFinite(bucket.remainingFraction)
      ? roundPercent(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100)
      : undefined;
    const usedPercent = remainingPercent === undefined ? undefined : roundPercent(100 - remainingPercent);
    return {
      modelId: model.modelId,
      variant: model.variant,
      tokenType: bucket.tokenType?.trim().toUpperCase() || "REQUESTS",
      remainingPercent,
      usedPercent,
      resetTime: bucket.resetTime,
      resetIn: resetIn(bucket.resetTime),
      remainingAmount: bucket.remainingAmount,
    };
  }).sort((left, right) => {
    const leftRemaining = left.remainingPercent ?? Number.POSITIVE_INFINITY;
    const rightRemaining = right.remainingPercent ?? Number.POSITIVE_INFINITY;
    if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;
    return (left.resetTime ?? "").localeCompare(right.resetTime ?? "");
  });

  const worst = normalized.find((bucket) => bucket.remainingPercent !== undefined);
  const used = percentLabel(worst?.usedPercent);

  return {
    summary: {
      label: used ? `${used} used` : "quota n/a",
      usedPercent: worst?.usedPercent,
      remainingPercent: worst?.remainingPercent,
      resetTime: worst?.resetTime,
      resetIn: worst?.resetIn,
      modelId: worst?.modelId,
    },
    buckets: normalized,
  };
}

function baseReport(projectRoot: string, status: QuotaReport["status"], message?: string): QuotaReport {
  return {
    version: OGB_VERSION,
    projectRoot,
    generatedAt: new Date().toISOString(),
    status,
    summary: { label: "quota n/a" },
    buckets: [],
    message,
    source: sourceInfo(),
  };
}

export async function refreshQuota(options: QuotaOptions = {}): Promise<QuotaReport> {
  const paths = resolveProjectPaths(options.projectRoot, options.homeDir);
  const write = options.write !== false;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;

  if (!options.force) {
    const cached = cachedReport(paths.quotaPath, ttlMs);
    if (cached) return cached;
  }

  let report: QuotaReport;
  try {
    const auth = await resolveAuth({ homeDir: paths.homeDir });
    if (!auth.accessToken) {
      report = baseReport(paths.projectRoot, "unavailable", auth.message);
      if (auth.projectId) report.projectId = auth.projectId;
    } else if (!auth.projectId) {
      report = baseReport(paths.projectRoot, "unavailable", "Projeto Gemini Code Assist nao encontrado no auth do OpenCode.");
    } else {
      const quota = await retrieveUserQuota(auth.accessToken, auth.projectId);
      if (!quota?.buckets?.length) {
        report = baseReport(paths.projectRoot, "unavailable", `Nenhum bucket de quota retornado para ${auth.projectId}.`);
        report.projectId = auth.projectId;
      } else {
        const summarized = summarizeQuotaBuckets(quota.buckets);
        report = {
          ...baseReport(paths.projectRoot, "ok"),
          projectId: auth.projectId,
          summary: summarized.summary,
          buckets: summarized.buckets,
        };
      }
    }
  } catch (error) {
    report = baseReport(paths.projectRoot, "error", error instanceof Error ? error.message : String(error));
  }

  if (write) writeJson(paths.quotaPath, report);
  return report;
}

export function formatQuota(report: QuotaReport): string {
  const lines = [
    "OpenCode Gemini Bridge Quota",
    `Status: ${report.status.toUpperCase()}`,
    `Source: ${report.source.manualCommand} / ${report.source.name}`,
  ];
  if (report.projectId) lines.push(`Project: ${report.projectId}`);
  lines.push(`Summary: ${report.summary.label}${report.summary.resetIn ? `, reset ${report.summary.resetIn}` : ""}`);
  if (report.message) lines.push(`Message: ${report.message}`);
  return `${lines.join("\n")}\n`;
}
