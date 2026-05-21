import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput, type Instance } from "ink";
import { BINARY, DISPLAY } from "../../brand.js";
import { filterHelpCommands, formatHelpRunLine, helpActionsForCommand, type HelpAction, type HelpCommand } from "../../help-catalog.js";
import { HELP_CATEGORY_COLORS } from "../../presentation/theme.js";

export interface InteractiveHelpSelection {
  command: HelpCommand;
  action: HelpAction;
  args: string[];
}

function frameWidth(): number {
  return Math.max(20, process.stdout.columns ?? 100);
}

function useTerminalWidth(): number {
  const [width, setWidth] = useState(frameWidth());

  useEffect(() => {
    const update = () => setWidth(frameWidth());
    process.stdout.on("resize", update);
    process.on("SIGWINCH", update);
    update();
    return () => {
      process.stdout.off("resize", update);
      process.off("SIGWINCH", update);
    };
  }, []);

  return width;
}

function categoryColor(category: HelpCommand["category"]): string {
  return HELP_CATEGORY_COLORS[category] ?? "white";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function truncate(value: string, width: number): string {
  if (width <= 1) return value.slice(0, Math.max(0, width));
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

function visibleWindow<T>(items: readonly T[], selected: number, size: number): { items: T[]; offset: number } {
  const offset = clamp(selected - Math.floor(size / 2), 0, Math.max(0, items.length - size));
  return { items: items.slice(offset, offset + size), offset };
}

const HelpDetails = React.memo(function HelpDetails(props: { command: HelpCommand | undefined; detailMode?: boolean; title?: string }) {
  const command = props.command;
  if (!command) {
    return React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "No commands found"),
      React.createElement(Text, { color: "gray" }, "Clear the filter or type a broader term."),
    );
  }
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    props.title ? React.createElement(Text, { color: "gray" }, props.title) : null,
    React.createElement(Text, { bold: true }, `${BINARY} ${command.name}`),
    command.aliases?.length
      ? React.createElement(Text, { color: "gray" }, `Aliases: ${command.aliases.join(", ")}`)
      : null,
    React.createElement(Box, { marginTop: 1 },
      React.createElement(Text, null, command.description),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Usage"),
      React.createElement(Text, { color: "gray" }, command.usage),
    ),
    React.createElement(Box, { marginTop: 1, flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Examples"),
      ...command.examples.map((example) => React.createElement(Text, { key: example, color: "gray" }, `- ${example}`)),
    ),
  );
});

function actionRunnable(action: HelpAction | undefined): action is HelpAction & { args: string[] } {
  return Boolean(action?.args && action.runnable !== false);
}

const HelpActionList = React.memo(function HelpActionList(props: {
  actions: HelpAction[];
  selected: number;
  width: number;
  narrow: boolean;
  message?: string;
}) {
  if (props.actions.length === 0) {
    return React.createElement(Box, { flexDirection: "column", marginTop: 1 },
      React.createElement(Text, { bold: true }, "Actions"),
      React.createElement(Text, { color: "yellow" }, "No runnable actions are documented for this command yet."),
    );
  }
  const window = visibleWindow(props.actions, props.selected, props.narrow ? 5 : 8);
  const labelWidth = props.narrow ? Math.max(16, props.width - 10) : Math.min(34, Math.max(20, Math.floor(props.width * 0.34)));
  const commandWidth = props.narrow ? Math.max(18, props.width - 8) : Math.max(20, props.width - labelWidth - 20);
  return React.createElement(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.createElement(Text, { bold: true }, "Actions and subcommands"),
    React.createElement(Text, { color: "gray" }, "Select one action, then press Enter to run it."),
    React.createElement(
      Box,
      { flexDirection: "column", marginTop: 1 },
      ...window.items.map((action, index) => {
        const actualIndex = window.offset + index;
        const active = actualIndex === props.selected;
        const runnable = actionRunnable(action);
        const commandLine = action.args ? formatHelpRunLine(action.args) : action.label;
        const status = runnable ? "run" : "manual";
        const color = active ? runnable ? "green" : "yellow" : "gray";
        return props.narrow
          ? React.createElement(Box, { key: `${action.label}-${actualIndex}`, flexDirection: "column", marginBottom: 1 },
            React.createElement(Text, { color, bold: active }, `${active ? ">" : " "} ${action.label}`),
            React.createElement(Text, { color: runnable ? "cyan" : "yellow" }, `  ${status} ${truncate(commandLine, commandWidth)}`),
            React.createElement(Text, { color: active ? "white" : "gray" }, `  ${action.description}`),
            active && !runnable && action.hint ? React.createElement(Text, { color: "yellow" }, `  ${action.hint}`) : null,
          )
          : React.createElement(Box, { key: `${action.label}-${actualIndex}`, flexDirection: "column", marginBottom: 1 },
            React.createElement(Box, { flexDirection: "row" },
              React.createElement(Text, { color, bold: active }, `${active ? ">" : " "} ${truncate(action.label, labelWidth).padEnd(labelWidth)} `),
              React.createElement(Text, { color: runnable ? "cyan" : "yellow" }, `${status.padEnd(6)} `),
              React.createElement(Text, { color: active ? "white" : "gray" }, truncate(commandLine, commandWidth)),
            ),
            React.createElement(Text, { color: active ? "white" : "gray" }, `    ${action.description}`),
            active && !runnable && action.hint ? React.createElement(Text, { color: "yellow" }, `    ${action.hint}`) : null,
          );
      }),
    ),
    props.message ? React.createElement(Box, { marginTop: 1 },
      React.createElement(Text, { color: "yellow" }, props.message),
    ) : null,
  );
});

function HelpApp(props: { commands: HelpCommand[]; onLaunch: (selection: InteractiveHelpSelection) => void }) {
  const { exit } = useApp();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [detailMode, setDetailMode] = useState(false);
  const [actionSelected, setActionSelected] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const width = useTerminalWidth();
  const narrow = width < 72;
  const nameWidth = narrow ? Math.max(10, width - 22) : Math.min(18, Math.max(12, Math.floor(width * 0.22)));
  const summaryWidth = narrow ? Math.max(12, width - 6) : Math.max(20, width - nameWidth - 22);
  const filtered = useMemo(() => filterHelpCommands(query, props.commands), [props.commands, query]);
  const safeSelected = filtered.length === 0 ? 0 : clamp(selected, 0, filtered.length - 1);
  const window = visibleWindow(filtered, safeSelected, narrow ? 8 : 12);
  const current = filtered[safeSelected];
  const actions = current ? helpActionsForCommand(current) : [];
  const safeActionSelected = actions.length === 0 ? 0 : clamp(actionSelected, 0, actions.length - 1);
  const currentAction = actions[safeActionSelected];
  const controls = detailMode
    ? actionRunnable(currentAction) ? "Enter run action  Esc/backspace back  ↑↓ move  q exit" : "manual action  Esc/backspace back  ↑↓ move  q exit"
    : "Enter select  q/Esc exit  ↑↓ move  type filter";

  useInput((input, key) => {
    if (detailMode) {
      if (key.return && current && actionRunnable(currentAction)) {
        props.onLaunch({ command: current, action: currentAction, args: currentAction.args });
        exit();
        return;
      }
      if (key.return && currentAction && !actionRunnable(currentAction)) {
        setActionMessage(currentAction.hint ?? "This action needs arguments before it can run from the guide.");
        return;
      }
      if (key.upArrow || input === "k") {
        setActionSelected((value) => clamp(value - 1, 0, Math.max(0, actions.length - 1)));
        setActionMessage(undefined);
        return;
      }
      if (key.downArrow || input === "j") {
        setActionSelected((value) => clamp(value + 1, 0, Math.max(0, actions.length - 1)));
        setActionMessage(undefined);
        return;
      }
      if (key.pageUp) {
        setActionSelected((value) => clamp(value - 5, 0, Math.max(0, actions.length - 1)));
        setActionMessage(undefined);
        return;
      }
      if (key.pageDown) {
        setActionSelected((value) => clamp(value + 5, 0, Math.max(0, actions.length - 1)));
        setActionMessage(undefined);
        return;
      }
      if (key.escape || key.backspace || key.delete) {
        setDetailMode(false);
        setActionMessage(undefined);
        return;
      }
      if (input === "q" || input === "Q") {
        exit();
      }
      return;
    }
    if (key.escape) {
      if (query) {
        setQuery("");
        setSelected(0);
      } else {
        exit();
      }
      return;
    }
    if ((input === "q" || input === "Q") && !query) {
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      setSelected((value) => clamp(value - 1, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.downArrow || input === "j") {
      setSelected((value) => clamp(value + 1, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.pageUp) {
      setSelected((value) => clamp(value - 6, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.pageDown) {
      setSelected((value) => clamp(value + 6, 0, Math.max(0, filtered.length - 1)));
      return;
    }
    if (key.return && current) {
      setDetailMode(true);
      setActionSelected(0);
      setActionMessage(undefined);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      setSelected(0);
      return;
    }
    if (input && /^[\w\s./:-]$/.test(input)) {
      setQuery((value) => `${value}${input}`);
      setSelected(0);
    }
  });

  return React.createElement(
    Box,
    { borderStyle: "round", borderColor: "gray", paddingX: 1, flexDirection: "column", width },
    narrow
      ? React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true, color: "green" }, `${DISPLAY} command guide`),
        React.createElement(Text, { color: "gray" }, controls),
      )
      : React.createElement(
        Box,
        { flexDirection: "row", justifyContent: "space-between" },
        React.createElement(Text, { bold: true, color: "green" }, `${DISPLAY} command guide`),
        React.createElement(Text, { color: "gray" }, controls),
    ),
    detailMode
      ? React.createElement(React.Fragment, null,
        React.createElement(HelpDetails, { command: current, detailMode: true, title: "Selected command" }),
        React.createElement(HelpActionList, {
          actions,
          selected: safeActionSelected,
          width,
          narrow,
          message: actionMessage,
        }),
      )
      : React.createElement(React.Fragment, null,
        React.createElement(Text, { color: "gray" }, query ? `Filter: ${query}` : "Filter: type any command, topic, or flag"),
        React.createElement(
          Box,
          { flexDirection: "column", marginTop: 1 },
          ...window.items.map((command, index) => {
            const actualIndex = window.offset + index;
            const active = actualIndex === safeSelected;
            const prefix = active ? ">" : " ";
            const name = truncate(command.name, nameWidth);
            const category = truncate(command.category, 9);
            const summary = truncate(command.summary, summaryWidth);
            return narrow
              ? React.createElement(Box, { key: command.name, flexDirection: "column", marginBottom: 1 },
                React.createElement(Box, { flexDirection: "row" },
                  React.createElement(Text, { color: active ? "green" : "gray", bold: active }, `${prefix} ${name}`),
                  React.createElement(Text, { color: categoryColor(command.category) }, `  ${category}`),
                ),
                React.createElement(Text, { color: active ? "white" : "gray" }, `  ${summary}`),
              )
              : React.createElement(Box, { key: command.name, flexDirection: "row" },
                React.createElement(Text, { color: active ? "green" : "gray", bold: active }, `${prefix} ${name.padEnd(nameWidth)} `),
                React.createElement(Text, { color: categoryColor(command.category) }, `${category.padEnd(9)} `),
                React.createElement(Text, { color: active ? "white" : "gray" }, summary),
              );
          }),
        ),
        React.createElement(HelpDetails, { command: current, title: "Preview. Press Enter for actions and subcommands." }),
      ),
  );
}

export async function renderInteractiveHelp(commands: HelpCommand[]): Promise<InteractiveHelpSelection | undefined> {
  let instance: Instance | undefined;
  let selection: InteractiveHelpSelection | undefined;
  try {
    instance = render(React.createElement(HelpApp, {
      commands,
      onLaunch: (nextSelection) => {
        selection = nextSelection;
      },
    }), {
      exitOnCtrlC: true,
      patchConsole: false,
    });
    await instance.waitUntilExit();
    return selection;
  } finally {
    instance?.unmount();
    instance?.cleanup();
  }
}
