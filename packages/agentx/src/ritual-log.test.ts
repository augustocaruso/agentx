import assert from "node:assert/strict";
import test from "node:test";
import { DISPLAY } from "./brand.js";
import { formatRitualFinishedLine, formatRitualProgressLine, formatRitualStartLine, RitualLogPrinter } from "./ritual-log.js";

test("cargo-like ritual log does not render the old panel vocabulary", () => {
  const lines: string[] = [];
  const printer = new RitualLogPrinter("update", (line) => lines.push(line));

  printer.start("/tmp/project");
  printer.step({
    stepId: "download",
    label: "Fetch the selected agentX release.",
    status: "running",
    message: "Fetching release assets.",
  });
  printer.step({
    stepId: "download",
    label: "Fetch the selected agentX release.",
    status: "pass",
    message: "Release assets fetched.",
  });
  printer.finish({ statusLabel: "PASS", callouts: [], next: ["Restart OpenCode so the new plugin/sidebar code is loaded."] });

  const output = lines.join("\n");
  assert.match(output, new RegExp(`Updating ${DISPLAY} for /tmp/project`));
  assert.match(output, /Running Fetch the selected agentX release: Fetching release assets/);
  assert.match(output, /Finished Fetch the selected agentX release: Release assets fetched/);
  assert.match(output, new RegExp(`Finished ${DISPLAY} update`));
  assert.doesNotMatch(output, /╭|╰|TODOs|Final report|Working:/);
});

test("cargo-like ritual log keeps warnings quiet and actionable", () => {
  const lines: string[] = [];
  const printer = new RitualLogPrinter("install", (line) => lines.push(line));

  printer.start("/Users/me");
  printer.step({
    stepId: "check",
    label: "Verify the updated bridge.",
    status: "warn",
    message: "Post-update check completed with warnings: hook projection is unavailable.",
  });
  printer.finish({
    statusLabel: "WARN",
    callouts: ["doctor: hook projection is unavailable."],
    next: ["Run `agentx check --plain --force` to inspect the post-update failure directly."],
  }, ["/Users/me/.config/agentx/generated/agentx-pass.json"]);

  const output = lines.join("\n");
  assert.match(output, /Warning Verify the updated bridge: Post-update check completed with warnings/);
  assert.match(output, new RegExp(`Finished ${DISPLAY} install with warnings`));
  assert.match(output, /Note doctor: hook projection is unavailable/);
  assert.match(output, /Next Run `agentx check --plain --force`/);
  assert.match(output, /Report \/Users\/me\/.config\/agentx\/generated\/agentx-pass\.json/);
  assert.doesNotMatch(output, /Problems|blockers need attention|review the warnings below/);
});

test("cargo-like ritual formatter compacts noisy multiline messages", () => {
  const line = formatRitualProgressLine({
    stepId: "install",
    label: "Install the selected agentX release.",
    status: "fail",
    message: "line one\r\n\nline two ".repeat(40),
  });

  assert.ok(line);
  assert.match(line, /Error Install the selected agentX release: line one line two/);
  assert.doesNotMatch(line, /\r|\n/);
  assert.ok(line.length <= 280);
});

test("cargo-like ritual start and finish lines are branded", () => {
  assert.equal(formatRitualStartLine("check", "/tmp/project"), `Checking ${DISPLAY} for /tmp/project`);
  assert.equal(formatRitualFinishedLine("check", { statusLabel: "FAIL" }), ` Finished ${DISPLAY} check with errors`);
});
