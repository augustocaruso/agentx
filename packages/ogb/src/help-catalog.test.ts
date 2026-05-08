import assert from "node:assert/strict";
import test from "node:test";
import { filterHelpCommands, findHelpCommand, formatHelpCatalog, formatHelpCommand, formatHelpRunLine, HELP_COMMANDS, helpActionsForCommand, runArgsForHelpCommand } from "./help-catalog.js";
import { program } from "./cli.js";

test("help catalog exposes the recommended cargo-like commands", () => {
  const recommended = HELP_COMMANDS.filter((command) => command.recommended).map((command) => command.name);

  assert.deepEqual(recommended, ["install", "update", "check", "reset", "dashboard"]);
});

test("help catalog resolves aliases to their canonical command", () => {
  assert.equal(findHelpCommand("pass")?.name, "check");
  assert.equal(findHelpCommand("self-update")?.name, "update");
  assert.equal(findHelpCommand("bridge")?.name, "dashboard");
  assert.equal(findHelpCommand("quota")?.name, "limits");
});

test("help catalog documents every registered top-level CLI command", () => {
  const documented = new Set(HELP_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
  const missing = program.commands
    .map((command) => command.name())
    .filter((name) => !documented.has(name));

  assert.deepEqual(missing, []);
});

test("help catalog filters commands by command name, alias, category, and description", () => {
  assert.deepEqual(filterHelpCommands("fallback").map((command) => command.name).slice(0, 3), ["install", "setup-ux"]);
  assert.ok(filterHelpCommands("Extensions").some((command) => command.name === "trust-report"));
  assert.ok(filterHelpCommands("self-update").some((command) => command.name === "update"));
  assert.ok(filterHelpCommands("--reset-global").some((command) => command.name === "install"));
});

test("help catalog ranks direct command matches before incidental description matches", () => {
  assert.equal(filterHelpCommands("doctor")[0]?.name, "doctor");
  assert.equal(filterHelpCommands("bridge")[0]?.name, "dashboard");
});

test("plain help catalog and command details include descriptions and examples", () => {
  const catalog = formatHelpCatalog();
  const check = formatHelpCommand(findHelpCommand("check")!);

  assert.match(catalog, /Recommended/);
  assert.match(catalog, /install\s+Install or reinstall/);
  assert.match(catalog, /Use `ogb help <command>`/);
  assert.match(check, /Run the complete bridge health ritual/);
  assert.match(check, /Usage: ogb check/);
  assert.match(check, /Examples/);
  assert.match(check, /Actions/);
  assert.match(check, /ogb check --no-extension-update/);
  assert.match(check, /ogb check --no-patches/);
});

test("interactive help exposes runnable commands and blocks commands that need required arguments", () => {
  assert.deepEqual(runArgsForHelpCommand(findHelpCommand("check")!), ["check"]);
  assert.deepEqual(runArgsForHelpCommand(findHelpCommand("telemetry")!), ["telemetry", "status"]);
  assert.equal(runArgsForHelpCommand(findHelpCommand("install-extension")!), undefined);
  assert.equal(formatHelpRunLine(["telemetry", "status"]), "ogb telemetry status");
});

test("interactive help exposes concrete actions for selected commands", () => {
  const checkActions = helpActionsForCommand(findHelpCommand("check")!);
  assert.ok(checkActions.some((action) => action.args?.join(" ") === "check"));
  assert.ok(checkActions.some((action) => action.args?.join(" ") === "check --no-extension-update"));
  assert.ok(checkActions.some((action) => action.args?.join(" ") === "check --no-patches"));
  assert.ok(checkActions.every((action) => action.runnable !== false));

  const telemetryActions = helpActionsForCommand(findHelpCommand("telemetry")!);
  assert.deepEqual(
    telemetryActions.slice(0, 7).map((action) => action.args?.join(" ")),
    [
      "telemetry status",
      "telemetry preview",
      "telemetry send",
      "telemetry disable",
      "telemetry setup-email --dry-run",
      "telemetry enable --endpoint <url> --token <token>",
      "telemetry record --workflow <name>",
    ],
  );
  assert.equal(telemetryActions.find((action) => action.args?.includes("<token>"))?.runnable, false);
});

test("interactive help actions have specific descriptions instead of generic placeholders", () => {
  for (const command of HELP_COMMANDS) {
    for (const action of helpActionsForCommand(command)) {
      assert.notEqual(action.description, "Documented command example.", `${command.name}: ${action.label}`);
      assert.ok(action.description.length > 12, `${command.name}: ${action.label}`);
    }
  }

  const dashboardActions = helpActionsForCommand(findHelpCommand("dashboard")!);
  assert.deepEqual(
    dashboardActions.map((action) => action.args?.join(" ")),
    [
      "dashboard",
      "bridge",
      "dashboard --json",
      "dashboard --no-refresh",
      "dashboard --write-only",
      "dashboard --strict",
    ],
  );
});
