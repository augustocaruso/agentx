import type { InstallReport } from "../../install.js";
import type { PassReport } from "../../pass.js";
import React, { useEffect, useState } from "react";
import { Box, Text, render, type Instance } from "ink";
import { ICONS } from "../../presentation/theme.js";
import { spawnCommand } from "../../process.js";
import type { ResetReport } from "../../reset.js";
import { RITUAL_PROGRESS_SCHEMA_VERSION, type RitualProgressJsonEvent, type RitualProgressSink, type RitualProgressStatus } from "../../ritual-progress.js";
import { RitualLogPrinter } from "../../ritual-log.js";
import type { SelfUpdateReport } from "../../self-update.js";
import {
  applyRitualProgressEvent,
  colorFromTone,
  createLiveRitualModel,
  failLiveRitualModel,
  finishLiveRitualModel,
  finishLiveRitualModelFromProgressEvent,
  RITUAL_UI_SPINNER_INTERVAL_MS,
  ritualViewModel,
  shouldAnimateRitualUi,
  toneFromProgress,
  type LiveRitualModel,
  type LiveRitualStep,
  type RitualMetric,
  type RitualProcessUiResult,
  type RunWithRitualProcessUiOptions,
  type RunWithRitualUiOptions,
} from "../../ritual-view-model.js";

type RitualSubscriber = (model: LiveRitualModel) => void;

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const FINAL_RENDER_SETTLE_MS = 80;

class RitualLiveStore {
  private model: LiveRitualModel;
  private readonly subscribers = new Set<RitualSubscriber>();

  constructor(model: LiveRitualModel) {
    this.model = model;
  }

  snapshot(): LiveRitualModel {
    return this.model;
  }

  set(model: LiveRitualModel): void {
    this.model = model;
    for (const subscriber of this.subscribers) subscriber(model);
  }

  update(updateModel: (model: LiveRitualModel) => LiveRitualModel): void {
    this.set(updateModel(this.model));
  }

  subscribe(subscriber: RitualSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.model);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

function shouldUseLogFallback(): boolean {
  return process.env.AGENTX_RITUAL_UI === "log" || process.env.OGB_RITUAL_UI === "log" || !process.stdout.isTTY;
}

function useRitualModel(store: RitualLiveStore): LiveRitualModel {
  const [model, setModel] = useState(store.snapshot());
  useEffect(() => store.subscribe(setModel), [store]);
  return model;
}

function useSpinnerFrame(model: LiveRitualModel, animate: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!animate || model.final) return undefined;
    const timer = setInterval(() => {
      setFrame((value) => value + 1);
    }, RITUAL_UI_SPINNER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [animate, model.final]);
  return frame;
}

function terminalWidth(): number {
  return Math.max(72, process.stdout.columns ?? 100);
}

function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return text.slice(0, Math.max(0, maxWidth));
  return text.length > maxWidth ? `${text.slice(0, maxWidth - 1)}…` : text;
}

function formatElapsed(startedAt: number, finishedAt: number | undefined): string {
  const durationMs = Math.max(0, (finishedAt ?? Date.now()) - startedAt);
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

function progressCounts(steps: LiveRitualStep[]): { complete: number; total: number } {
  const visible = steps.filter((step) => !(step.optional && step.status === "queued"));
  return {
    complete: visible.filter((step) => step.status === "pass" || step.status === "warn" || step.status === "fail" || step.status === "skipped").length,
    total: visible.length,
  };
}

function progressBar(steps: LiveRitualStep[], width: number): string {
  const counts = progressCounts(steps);
  const total = Math.max(1, counts.total);
  const filled = Math.max(0, Math.min(width, Math.round((counts.complete / total) * width)));
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

function statusIcon(status: RitualProgressStatus, frame: number, animate: boolean): string {
  if (status === "running") return animate ? SPINNER_FRAMES[frame % SPINNER_FRAMES.length] : "•";
  if (status === "pass") return ICONS.pass;
  if (status === "warn") return ICONS.warn;
  if (status === "fail") return ICONS.fail;
  if (status === "skipped") return ICONS.preview;
  return "·";
}

function statusColor(status: RitualProgressStatus): string {
  return colorFromTone(toneFromProgress(status));
}

function visibleSteps(steps: LiveRitualStep[]): LiveRitualStep[] {
  const filtered = steps.filter((step) => !(step.optional && (step.status === "queued" || step.status === "skipped")));
  if (filtered.length <= 9) return filtered;
  const runningIndex = filtered.findIndex((step) => step.status === "running");
  if (runningIndex < 0) return filtered.slice(-9);
  const start = Math.max(0, Math.min(filtered.length - 9, runningIndex - 4));
  return filtered.slice(start, start + 9);
}

function MetricRow(props: { metrics: RitualMetric[] }) {
  if (props.metrics.length === 0) return null;
  const line = props.metrics.map((metric) => `${metric.label} ${metric.value}`).join("   ");
  return React.createElement(
    Box,
    { marginTop: 1 },
    React.createElement(Text, { color: "gray" }, line),
  );
}

function RitualStepRow(props: { step: LiveRitualStep; frame: number; animate: boolean; width: number }) {
  const detail = props.step.message ?? props.step.detail;
  const labelWidth = Math.max(24, props.width - 8);
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(
      Box,
      { flexDirection: "row" },
      React.createElement(Text, { color: statusColor(props.step.status), bold: props.step.status === "running" }, `${statusIcon(props.step.status, props.frame, props.animate)} `),
      React.createElement(Text, { color: props.step.status === "queued" ? "gray" : "white", bold: props.step.status === "running" }, truncate(props.step.label, labelWidth)),
    ),
    detail
      ? React.createElement(Text, { color: props.step.status === "fail" ? "red" : "gray" }, `  ${truncate(detail, Math.max(20, props.width - 4))}`)
      : null,
  );
}

function BulletSection(props: { title: string; items: string[]; color?: string; width: number }) {
  if (props.items.length === 0) return null;
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true, color: props.color ?? "white" }, props.title),
    ...props.items.slice(0, 5).map((item) => React.createElement(Text, { key: item, color: props.color ?? "gray" }, `• ${truncate(item, Math.max(20, props.width - 4))}`)),
  );
}

function RitualInkApp(props: { store: RitualLiveStore; animate: boolean }) {
  const model = useRitualModel(props.store);
  const frame = useSpinnerFrame(model, props.animate);
  const width = terminalWidth();
  const counts = progressCounts(model.steps);
  const barWidth = Math.max(12, Math.min(28, width - 44));
  const toneColor = colorFromTone(model.tone);
  const subtitleWidth = Math.max(20, width - 28);

  return React.createElement(
    Box,
    { flexDirection: "column", width },
    React.createElement(
      Box,
      { flexDirection: "row", justifyContent: "space-between" },
      React.createElement(Text, { bold: true, color: toneColor }, `${ICONS[model.tone]} ${model.statusLabel} ${model.title}`),
      React.createElement(Text, { color: "gray" }, formatElapsed(model.startedAt, model.finishedAt)),
    ),
    React.createElement(Text, { color: "gray" }, truncate(model.subtitle, subtitleWidth)),
    React.createElement(
      Box,
      { flexDirection: "row", marginTop: 1 },
      React.createElement(Text, { color: toneColor }, progressBar(model.steps, barWidth)),
      React.createElement(Text, { color: "gray" }, ` ${counts.complete}/${counts.total}`),
    ),
    React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      ...visibleSteps(model.steps).map((step) => React.createElement(RitualStepRow, {
        key: step.stepId,
        step,
        frame,
        animate: props.animate,
        width,
      })),
    ),
    React.createElement(MetricRow, { metrics: model.metrics }),
    React.createElement(BulletSection, { title: "Needs attention", items: model.callouts, color: model.tone === "fail" ? "red" : "yellow", width }),
    React.createElement(BulletSection, { title: "Next", items: model.next, color: "cyan", width }),
    React.createElement(BulletSection, { title: "Files", items: model.files, color: "gray", width }),
  );
}

function renderRitualInk(store: RitualLiveStore): Instance {
  return render(React.createElement(RitualInkApp, {
    store,
    animate: shouldAnimateRitualUi(),
  }), {
    exitOnCtrlC: false,
    patchConsole: false,
  });
}

async function settleRitualInk(instance: Instance | undefined): Promise<void> {
  if (!instance) return;
  await new Promise((resolve) => setTimeout(resolve, FINAL_RENDER_SETTLE_MS));
  instance.unmount();
  instance.cleanup();
}

async function runWithRitualLogUi<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport>(
  options: RunWithRitualUiOptions<TReport>,
): Promise<TReport> {
  const printer = new RitualLogPrinter(options.kind);
  printer.start(options.subtitle);

  const sink: RitualProgressSink = (event) => {
    printer.step(event);
  };

  try {
    const report = await options.run(sink);
    const view = ritualViewModel(options.kind, report);
    printer.finish(view, view.files);
    return report;
  } catch (error) {
    printer.error(error);
    throw error;
  }
}

export async function runWithRitualUi<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport>(
  options: RunWithRitualUiOptions<TReport>,
): Promise<TReport> {
  if (shouldUseLogFallback()) return await runWithRitualLogUi(options);

  const store = new RitualLiveStore(createLiveRitualModel(options.kind, options.subtitle, options.steps));
  const instance = renderRitualInk(store);
  const sink: RitualProgressSink = (event) => {
    store.update((model) => applyRitualProgressEvent(model, event));
  };

  try {
    const report = await options.run(sink);
    store.update((model) => finishLiveRitualModel(model, report));
    await settleRitualInk(instance);
    return report;
  } catch (error) {
    store.update((model) => failLiveRitualModel(model, error));
    await settleRitualInk(instance);
    throw error;
  }
}

function parseProgressLine(line: string): RitualProgressJsonEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as Partial<RitualProgressJsonEvent>;
    if (parsed.schemaVersion !== RITUAL_PROGRESS_SCHEMA_VERSION || typeof parsed.type !== "string") return undefined;
    return parsed as RitualProgressJsonEvent;
  } catch {
    return undefined;
  }
}

function tailText(text: string, maxLines = 6): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .join("\n");
}

export async function runWithRitualProcessUi(options: RunWithRitualProcessUiOptions): Promise<RitualProcessUiResult> {
  if (shouldUseLogFallback()) return await runWithRitualLogProcessUi(options);

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalReceived = false;
  const store = new RitualLiveStore(createLiveRitualModel(options.kind, options.subtitle, options.steps));
  const instance = renderRitualInk(store);

  const child = spawnCommand(options.command, options.args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseProgressLine(line);
      if (!event) {
        stderrBuffer += `${line}\n`;
        continue;
      }
      if (event.type === "ritual.started") {
        store.set(createLiveRitualModel(options.kind, options.subtitle, event.steps));
      } else if (event.type === "ritual.step") {
        store.update((model) => applyRitualProgressEvent(model, event));
      } else if (event.type === "ritual.finished") {
        finalReceived = true;
        store.update((model) => finishLiveRitualModelFromProgressEvent(model, event));
      } else if (event.type === "ritual.error") {
        finalReceived = true;
        store.update((model) => failLiveRitualModel(model, event.error));
      }
    }
  });

  child.stderr?.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  return await new Promise<RitualProcessUiResult>((resolve) => {
    child.on("error", (error) => {
      store.update((model) => failLiveRitualModel(model, error));
      settleRitualInk(instance).then(() => resolve({ exitCode: 2 }));
    });
    child.on("exit", (code, signal) => {
      if (stdoutBuffer.trim()) {
        const event = parseProgressLine(stdoutBuffer);
        if (event?.type === "ritual.finished") {
          finalReceived = true;
          store.update((model) => finishLiveRitualModelFromProgressEvent(model, event));
        } else if (event?.type === "ritual.error") {
          finalReceived = true;
          store.update((model) => failLiveRitualModel(model, event.error));
        }
      }
      const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
      if (!finalReceived) {
        const tail = tailText(stderrBuffer) || `Ritual process exited with code ${exitCode}.`;
        store.update((model) => failLiveRitualModel(model, tail));
      }
      settleRitualInk(instance).then(() => resolve({ exitCode, signal }));
    });
  });
}

async function runWithRitualLogProcessUi(options: RunWithRitualProcessUiOptions): Promise<RitualProcessUiResult> {
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalReceived = false;
  const printer = new RitualLogPrinter(options.kind);
  printer.start(options.subtitle);

  const child = spawnCommand(options.command, options.args, {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  child.stdout?.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseProgressLine(line);
      if (!event) {
        stderrBuffer += `${line}\n`;
        continue;
      }
      if (event.type === "ritual.started") {
        continue;
      } else if (event.type === "ritual.step") {
        printer.step(event);
      } else if (event.type === "ritual.finished") {
        finalReceived = true;
        printer.finishFromProgress(event);
      } else if (event.type === "ritual.error") {
        finalReceived = true;
        printer.error(event.error, event.summary);
      }
    }
  });

  child.stderr?.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  return await new Promise<RitualProcessUiResult>((resolve) => {
    child.on("error", (error) => {
      printer.error(error);
      resolve({ exitCode: 2 });
    });
    child.on("exit", (code, signal) => {
      if (stdoutBuffer.trim()) {
        const event = parseProgressLine(stdoutBuffer);
        if (event?.type === "ritual.finished") {
          finalReceived = true;
          printer.finishFromProgress(event);
        } else if (event?.type === "ritual.error") {
          finalReceived = true;
          printer.error(event.error, event.summary);
        }
      }
      const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
      if (!finalReceived) {
        const tail = tailText(stderrBuffer) || `Ritual process exited with code ${exitCode}.`;
        printer.error(tail);
      }
      resolve({ exitCode, signal });
    });
  });
}
