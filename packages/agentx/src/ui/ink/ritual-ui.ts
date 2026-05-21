import type { InstallReport } from "../../install.js";
import type { PassReport } from "../../pass.js";
import { spawnCommand } from "../../process.js";
import type { ResetReport } from "../../reset.js";
import { RITUAL_PROGRESS_SCHEMA_VERSION, type RitualProgressJsonEvent, type RitualProgressSink } from "../../ritual-progress.js";
import { RitualLogPrinter } from "../../ritual-log.js";
import type { SelfUpdateReport } from "../../self-update.js";
import { ritualViewModel, type RitualProcessUiResult, type RunWithRitualProcessUiOptions, type RunWithRitualUiOptions } from "../../ritual-view-model.js";

export async function runWithRitualUi<TReport extends InstallReport | PassReport | ResetReport | SelfUpdateReport>(
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
