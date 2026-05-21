import { BINARY, DISPLAY } from "./brand.js";

export interface BuiltInTextFile {
  name: string;
  legacyNames?: string[];
  content: string;
}

export const BUILT_IN_AGENTS: BuiltInTextFile[] = [
  {
    name: "YOLO",
    legacyNames: ["yolo"],
    content: `---
description: Direct execution with minimal friction in a trusted workspace.
mode: primary
color: "#ffb4b4"
permission:
  question: allow
  todowrite: allow
  edit: allow
  bash: allow
  task: allow
  external_directory: allow
---

You are the YOLO mode of ${DISPLAY}.

Use this when the user selects this agent or when the project profile sets YOLO as the default.

Behavior:
- Execute directly when the request is clear.
- Do not ask permission for normal read, build, test, local git, or edit commands when intent is clear.
- Explain before destructive or irreversible actions, external publishing, or operations outside the workspace.
- Prefer non-interactive commands.
- When delegating generic engineering work, use the YOLO-worker subagent. Use specialized subagents only when the request needs their specific contract.
- At the end, summarize all changes.
`,
  },
  {
    name: "YOLO-worker",
    content: `---
description: Delegated low-friction execution for generic YOLO tasks.
mode: subagent
color: "#ffd0a6"
permission:
  read: allow
  edit: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  task: allow
  external_directory: allow
  question: allow
  todowrite: allow
  webfetch: allow
  websearch: allow
  lsp: allow
  skill: allow
  doom_loop: ask
---

You are the delegated worker for YOLO mode in ${DISPLAY}.

Use this subagent for generic engineering tasks when the primary YOLO agent wants to parallelize or isolate execution without losing YOLO behavior.

Behavior:
- Execute directly when the delegated scope is clear.
- Do not ask permission for normal read, build, test, local git, or edit commands inside the workspace.
- Explain before destructive or irreversible actions, external publishing, or operations outside the workspace.
- Prefer non-interactive commands.
- At the end, return a concise summary of changes, touched files, and verification.
`,
  },
];

export const REMOVED_BUILT_IN_AGENT_NAMES = ["automation", "study", "review", "explore"];
export const REMOVED_BUILT_IN_COMMAND_NAMES = ["study", "automate", "review", "explore"];

export const BUILT_IN_COMMANDS: BuiltInTextFile[] = [
  {
    name: "bridge",
    content: `---
description: Main ${DISPLAY} status panel
subtask: false
---

First run pwd to confirm the current directory.

Then run exactly:

${BINARY} check --project "$PWD"

Use that command output as the main source. If you need to read the generated file, read only this exact path inside the current directory:

.opencode/generated/agentx-dashboard.md

Do not use glob, find, or recursive home-directory search. If the panel shows the current project is home but the user expected another project, explain that OpenCode was opened from home and they should open OpenCode in the project directory or run ${BINARY} check --project /path/to/project.

Explain in plain language:
- whether the bridge is PASS, WARN, or FAIL;
- the last startup sync;
- loaded MCPs, skills, YOLO agent, and commands;
- projected Gemini extensions;
- the concrete next step.

Do not edit files.
`,
  },
  {
    name: "doctor",
    content: `---
description: Show ${DISPLAY} diagnostics
subtask: false
---

Run or guide the user to run ${BINARY} doctor. If .opencode/generated/agentx-doctor.json exists, read and summarize:

- loaded Gemini context;
- missing imports;
- skills;
- MCPs;
- agents/subagents;
- commands;
- warnings;
- next steps.

Do not edit files.
`,
  },
  {
    name: "sync",
    content: `---
description: Sync Gemini resources into OpenCode
subtask: false
---

Run or guide the user to run ${BINARY} sync --dry-run first. Then ask for confirmation before running the real ${BINARY} sync.

Explain which files will be generated or changed.
`,
  },
  {
    name: "resources",
    content: `---
description: List resources projected by the bridge
subtask: false
---

Leia .opencode/generated/agentx-dashboard.md, .opencode/generated/agentx-doctor.json e .opencode/generated/agentx-inventory.json quando existirem.

Summarize in plain language:
- active MCPs;
- available skills;
- available agents;
- available commands;
- detected Gemini extensions;
- warnings that need action.

Do not edit files.
`,
  },
  {
    name: "validate",
    content: `---
description: Validate the bridge end-to-end without calling a model by default
subtask: false
---

Run or guide the user to run ${BINARY} validate.

Use ${BINARY} validate --windows if the user is checking a Windows install.
Do not use --opencode-run unless explicitly requested, because it can spend tokens.

Then summarize:
- what passed;
- warnings;
- failures;
- the concrete next step.
`,
  },
  {
    name: "security-check",
    content: `---
description: Check obvious bridge safety risks
subtask: false
---

Run or guide the user to run ${BINARY} security-check.

Explain in plain language:
- whether any secret/token was materialized;
- whether YOLO kept guardrails;
- whether settings/extension hooks were synced and loose scripts stayed review-only;
- what must be fixed before distribution.
`,
  },
  {
    name: "telemetry",
    content: `---
description: Show and send local ${DISPLAY} telemetry
subtask: false
---

Run ${BINARY} telemetry status --project "$PWD" to see whether local/remote telemetry is active.

Se o mantenedor pedir para configurar recebimento por email, use:

${BINARY} telemetry setup-email --project "$PWD"

Ask only for what is missing: destination email, verified Resend sender, and Resend API key. Do not print the API key. If Wrangler is not logged in, guide the user to run npm exec --yes wrangler login and retry.

Se o usuario quiser revisar antes de enviar, execute:

${BINARY} telemetry preview --since 7d --project "$PWD"

Se o usuario pedir envio manual, execute:

${BINARY} telemetry send --since 7d --project "$PWD"

Normal sending only sends actionable problems remotely. Clean checks stay in preview/local. Use --include-pass only if the maintainer explicitly asks to test/debug the remote channel.

Se o usuario quiser desligar, execute:

${BINARY} telemetry disable --project "$PWD"

Never show, ask the user to paste, or save telemetry tokens in project files. To enable telemetry, use only endpoint/token values explicitly provided by the maintainer or packaged private defaults.
`,
  },
  {
    name: "agent-sync",
    content: `---
description: Plan safe agent-rules-sync adoption
subtask: false
---

Run or guide the user to run ${BINARY} adopt-agent-sync.

Do not install a daemon or enable background sync automatically.
Explain which files look like good bidirectional sync candidates and which
should remain observe-only because they are generated by ${DISPLAY} or belong to
extensions.
`,
  },
  {
    name: "status",
    content: `---
description: Summarize the current bridge state
subtask: false
---

Show a short ${DISPLAY} status.

Use ${BINARY} dashboard when you need to refresh the panel. Use ${BINARY} doctor if the dashboard points to warn/fail. Then answer:
- what is ready;
- what needs attention;
- the recommended next step.
`,
  },
  {
    name: "update-extensions",
    content: `---
description: Update Gemini Extensions and reproject OpenCode
subtask: false
---

Run or guide the user to run ${BINARY} update-extensions --dry-run first.

If the dry-run looks safe, run ${BINARY} update-extensions --auto-consent.
Then run or summarize ${BINARY} doctor.
`,
  },
  {
    name: "upgrade-ogb",
    content: `---
description: Update ${DISPLAY} from the official release
subtask: false
---

Run exactly:

${BINARY} update --project "$PWD"

Then run:

${BINARY} doctor --project "$PWD"

Explain in plain language:
- the previous and new version, if the output shows them;
- whether the update reapplied setup-ux/setup-opencode;
- whether doctor is clean;
- whether OpenCode needs a restart to load new plugins, commands, or default agent settings.
`,
  },
];
