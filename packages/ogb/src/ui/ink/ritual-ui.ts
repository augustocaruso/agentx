import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, type Instance, useAnimation, useStdout } from "ink";
import type { InstallReport } from "../../install.js";
import type { PassReport } from "../../pass.js";
import { spawnCommand } from "../../process.js";
import type { ResetReport } from "../../reset.js";
import { RITUAL_PROGRESS_SCHEMA_VERSION, type RitualProgressJsonEvent, type RitualProgressSink, type RitualProgressStatus } from "../../ritual-progress.js";
import type { SelfUpdateReport } from "../../self-update.js";
import {
  applyRitualProgressEvent,
  colorFromTone,
  createLiveRitualModel,
  failLiveRitualModel,
  finishLiveRitualModel,
  finishLiveRitualModelFromProgressEvent,
  shouldAnimateRitualUi,
  toneFromProgress,
  visibleTodoSteps,
  type LiveRitualModel,
  type LiveRitualStep,
  type RenderRitualOptions,
  type RitualMetric,
  type RitualProcessUiResult,
  type RitualTone,
  type RunWithRitualProcessUiOptions,
  type RunWithRitualUiOptions,
} from "../../ritual-view-model.js";

const RITUAL_UI_SPINNER_INTERVAL_MS = 1000;
const RITUAL_UI_MAX_FPS = 10;
const DEFAULT_RITUAL_UI_ROWS = 40;
const COMPACT_RITUAL_ROWS = 34;
const COMPACT_RITUAL_STEPS = 6;
const TIGHT_RITUAL_STEPS = 4;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function cleanInkFrame(raw: string): string {
  const withoutCursor = raw.replace(/\x1B\[\?25[lh]/g, "");
  const frames = withoutCursor
    .split(/\x1B\[(?:2J\x1B\[3J\x1B\[H|H\x1B\[2J|2J\x1B\[H)/g)
    .map((frame) => frame.trimEnd())
    .filter((frame) => frame.trim().length > 0);
  return frames.at(-1) ?? withoutCursor.trimEnd();
}

function statusText(status: RitualProgressStatus, spinner: string): string {
  if (status === "running") return spinner;
  if (status === "pass") return "OK";
  if (status === "warn") return "WARN";
  if (status === "fail") return "FAIL";
  if (status === "skipped") return "SKIP";
  return "....";
}

function SectionTitle(props: { children?: React.ReactNode }) {
  return React.createElement(Text, { bold: true, color: "white" }, props.children);
}

function MetricRow(props: { metric: RitualMetric }) {
  const tone = props.metric.tone ?? "neutral";
  return React.createElement(
    Box,
    { flexDirection: "row", marginRight: 3 },
    React.createElement(Text, { color: "gray" }, `${props.metric.label} `),
    React.createElement(Text, { bold: true, color: colorFromTone(tone) }, props.metric.value),
  );
}

function TodoRow(props: { step: LiveRitualStep; spinner: string; compact?: boolean }) {
  const tone = toneFromProgress(props.step.status);
  const active = props.step.status === "running";
  const muted = props.step.status === "queued" || props.step.status === "skipped";
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: props.compact ? 0 : 1 },
    React.createElement(
      Box,
      { flexDirection: "row" },
      React.createElement(Text, { color: colorFromTone(tone), bold: active || props.step.status === "fail" || props.step.status === "warn" }, `${statusText(props.step.status, props.spinner).padEnd(5)} `),
      React.createElement(Text, { bold: active, color: muted ? "gray" : undefined }, props.step.label),
    ),
    !props.compact && props.step.detail
      ? React.createElement(Box, { marginLeft: 6 },
        React.createElement(Text, { color: "gray" }, props.step.detail),
      )
      : null,
    !props.compact && props.step.message
      ? React.createElement(Box, { marginLeft: 6 },
        React.createElement(Text, { color: props.step.status === "fail" ? "red" : props.step.status === "warn" ? "yellow" : "gray" }, props.step.message),
      )
      : null,
  );
}

function BulletList(props: { title: string; items: string[]; tone?: RitualTone; limit?: number }) {
  if (props.items.length === 0) return null;
  const limit = Math.max(0, props.limit ?? 5);
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(SectionTitle, null, props.title),
    ...props.items.slice(0, limit).map((item, index) => React.createElement(Box, { key: `${props.title}-${index}`, marginTop: index === 0 ? 0 : 1 },
      React.createElement(Text, { color: props.tone ? colorFromTone(props.tone) : "gray" }, `- ${item}`),
    )),
  );
}

function useTerminalSize(): { width: number; rows: number } {
  const { stdout } = useStdout();
  const readSize = () => ({
    width: Math.max(20, stdout.columns ?? process.stdout.columns ?? 100),
    rows: Math.max(10, stdout.rows ?? process.stdout.rows ?? DEFAULT_RITUAL_UI_ROWS),
  });
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    const onResize = () => setSize(readSize());
    stdout.on?.("resize", onResize);
    process.stdout.on?.("resize", onResize);
    onResize();
    return () => {
      stdout.off?.("resize", onResize);
      process.stdout.off?.("resize", onResize);
    };
  }, [stdout]);
  return size;
}

function compactStepWindow(steps: LiveRitualStep[], currentStepId: string | undefined, maxSteps: number): LiveRitualStep[] {
  if (steps.length <= maxSteps) return steps;
  const currentIndex = Math.max(0, steps.findIndex((step) => step.stepId === currentStepId));
  const start = Math.min(Math.max(0, currentIndex - 2), Math.max(0, steps.length - maxSteps));
  return steps.slice(start, start + maxSteps);
}

function compactFinalSteps(steps: LiveRitualStep[], maxSteps: number): LiveRitualStep[] {
  if (steps.length <= maxSteps) return steps;
  const problemIds = new Set(
    steps
      .filter((step) => step.status === "fail" || step.status === "warn")
      .map((step) => step.stepId),
  );
  if (problemIds.size > 0) return steps.filter((step) => problemIds.has(step.stepId)).slice(0, maxSteps);
  const skippedIds = new Set(steps.filter((step) => step.status === "skipped").map((step) => step.stepId));
  if (skippedIds.size === 0) return steps.slice(-maxSteps);
  const importantIds = skippedIds;
  return steps.filter((step) => importantIds.has(step.stepId)).slice(0, maxSteps);
}

export function RitualPanel(props: { model: LiveRitualModel; animate: boolean }) {
  const model = props.model;
  const visibleSteps = visibleTodoSteps(model.steps);
  const { width, rows } = useTerminalSize();
  const animation = useAnimation({
    interval: RITUAL_UI_SPINNER_INTERVAL_MS,
    isActive: props.animate && !model.final,
  });
  const spinnerFrames = useMemo(() => ["◐", "◓", "◑", "◒"], []);
  const spinner = props.animate ? spinnerFrames[animation.frame % spinnerFrames.length] : "RUN";
  const current = visibleSteps.find((step) => step.status === "running")
    ?? visibleSteps.find((step) => step.stepId === model.currentStepId)
    ?? visibleSteps.find((step) => step.status === "queued")
    ?? visibleSteps.at(-1);
  const activeNow = props.animate && !model.final ? model.startedAt + animation.time : Date.now();
  const elapsed = formatElapsed((model.finishedAt ?? activeNow) - model.startedAt);
  const headerStatus = model.final ? elapsed : "running";
  const borderColor = model.final ? colorFromTone(model.tone) : "gray";
  const headline = model.final ? model.statusLabel : "RUN";
  const compact = rows <= COMPACT_RITUAL_ROWS || visibleSteps.length > COMPACT_RITUAL_STEPS || (model.final && model.callouts.length > 2);
  const maxSteps = rows <= 28 ? TIGHT_RITUAL_STEPS : COMPACT_RITUAL_STEPS;
  const displayedSteps = compact
    ? model.final
      ? compactFinalSteps(visibleSteps, maxSteps)
      : compactStepWindow(visibleSteps, current?.stepId ?? model.currentStepId, maxSteps)
    : visibleSteps;
  const bulletLimit = compact ? rows <= 28 ? 1 : 2 : 5;
  const todoTitle = compact && displayedSteps.length < visibleSteps.length ? `TODOs ${displayedSteps.length}/${visibleSteps.length}` : "TODOs";

  return React.createElement(
    Box,
    { borderStyle: "round", borderColor, paddingX: 1, paddingY: 0, flexDirection: "column", width },
    React.createElement(
      Box,
      { flexDirection: "row", justifyContent: "space-between" },
      React.createElement(Box, { flexDirection: "row" },
        React.createElement(Text, { color: model.final ? colorFromTone(model.tone) : "cyan", bold: true }, `${headline} `),
        React.createElement(Text, { bold: true }, model.title),
      ),
      React.createElement(Text, { color: "gray" }, headerStatus),
    ),
    React.createElement(Text, { color: "gray" }, model.subtitle),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, { color: "gray" }, model.final
        ? model.tone === "pass"
          ? "Final report: bridge is clean."
          : model.tone === "warn"
            ? "Final report: review the warnings below."
            : model.tone === "fail"
              ? "Final report: blockers need attention."
              : "Final report: preview completed."
        : `Working: ${current?.label ?? "Preparing ritual."}`),
      current?.message && !model.final ? React.createElement(Text, { color: "gray" }, current.message) : null,
    ),
    model.metrics.length > 0
      ? React.createElement(Box, { flexDirection: "row", flexWrap: "wrap", marginTop: 1 },
        ...model.metrics.map((metric) => React.createElement(MetricRow, { key: metric.label, metric })),
      )
      : null,
    React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      React.createElement(SectionTitle, null, todoTitle),
      ...displayedSteps.map((step) => React.createElement(TodoRow, { key: step.stepId, step, spinner, compact })),
    ),
    React.createElement(BulletList, { title: model.tone === "fail" ? "Problems" : "Notes", items: model.callouts, tone: model.tone === "fail" ? "fail" : "warn", limit: bulletLimit }),
    React.createElement(BulletList, { title: "Next", items: model.next, limit: bulletLimit }),
    React.createElement(BulletList, { title: "Reports", items: model.files, limit: compact ? 1 : 5 }),
  );
}

function renderModel(instance: Instance | undefined, model: LiveRitualModel, options: RenderRitualOptions): Instance {
  const node = React.createElement(RitualPanel, { model, animate: options.animate });
  if (instance) {
    instance.rerender(node);
    return instance;
  }
  return render(node, {
    exitOnCtrlC: false,
    incrementalRendering: true,
    maxFps: RITUAL_UI_MAX_FPS,
    patchConsole: false,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithRitualUi<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport>(
  options: RunWithRitualUiOptions<TReport>,
): Promise<TReport> {
  let model = createLiveRitualModel(options.kind, options.subtitle, options.steps);
  let instance: Instance | undefined;
  const renderOptions = { animate: shouldAnimateRitualUi() };
  instance = renderModel(instance, model, renderOptions);
  await delay(25);

  const sink: RitualProgressSink = (event) => {
    model = applyRitualProgressEvent(model, event);
    instance = renderModel(instance, model, renderOptions);
  };

  try {
    const report = await options.run(sink);
    model = finishLiveRitualModel(model, report);
    instance = renderModel(instance, model, renderOptions);
    await delay(40);
    return report;
  } catch (error) {
    model = failLiveRitualModel(model, error);
    instance = renderModel(instance, model, renderOptions);
    await delay(40);
    throw error;
  } finally {
    instance?.unmount();
    instance?.cleanup();
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
  let model = createLiveRitualModel(options.kind, options.subtitle, options.steps);
  let instance: Instance | undefined;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  let finalReceived = false;
  const renderOptions = { animate: shouldAnimateRitualUi() };
  instance = renderModel(instance, model, renderOptions);
  await delay(25);

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
        model = { ...model, steps: event.steps.map((step) => ({ ...step, status: "queued" })) };
      } else if (event.type === "ritual.step") {
        model = applyRitualProgressEvent(model, event);
      } else if (event.type === "ritual.finished") {
        finalReceived = true;
        model = finishLiveRitualModelFromProgressEvent(model, event);
      } else if (event.type === "ritual.error") {
        finalReceived = true;
        model = failLiveRitualModel(model, new Error(event.error));
        model = { ...model, next: event.summary?.next ?? model.next };
      }
      instance = renderModel(instance, model, renderOptions);
    }
  });

  child.stderr?.on("data", (chunk: string) => {
    stderrBuffer += chunk;
  });

  const result = await new Promise<RitualProcessUiResult>((resolve) => {
    child.on("error", (error) => {
      model = failLiveRitualModel(model, error);
      instance = renderModel(instance, model, renderOptions);
      resolve({ exitCode: 2 });
    });
    child.on("exit", (code, signal) => {
      if (stdoutBuffer.trim()) {
        const event = parseProgressLine(stdoutBuffer);
        if (event?.type === "ritual.finished") {
          finalReceived = true;
          model = finishLiveRitualModelFromProgressEvent(model, event);
        } else if (event?.type === "ritual.error") {
          finalReceived = true;
          model = failLiveRitualModel(model, new Error(event.error));
        }
      }
      const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
      if (!finalReceived) {
        const tail = tailText(stderrBuffer) || `Ritual process exited with code ${exitCode}.`;
        model = failLiveRitualModel(model, new Error(tail));
      }
      instance = renderModel(instance, model, renderOptions);
      resolve({ exitCode, signal });
    });
  });

  await delay(40);
  instance?.unmount();
  instance?.cleanup();
  return result;
}
