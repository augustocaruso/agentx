import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOpenCodeLaunchArgs, buildOpenCodeOpenArgs, projectOpenCodeAgentPreference, resolveOpenCodeOpenAgent } from "./launch.js";

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ogb-launch-"));
}

test("buildOpenCodeLaunchArgs starts OpenCode normally by default", () => {
  assert.deepEqual(buildOpenCodeLaunchArgs({}), []);
});

test("buildOpenCodeLaunchArgs can start OpenCode with an explicit agent", () => {
  assert.deepEqual(buildOpenCodeLaunchArgs({ agent: "YOLO" }), ["--agent", "YOLO"]);
});

test("buildOpenCodeLaunchArgs provides a YOLO shortcut", () => {
  assert.deepEqual(buildOpenCodeLaunchArgs({ yolo: true }), ["--agent", "YOLO"]);
});

test("buildOpenCodeLaunchArgs rejects conflicting agent options", () => {
  assert.throws(() => buildOpenCodeLaunchArgs({ yolo: true, agent: "agent" }), /Use --yolo or --agent agent/);
});

test("buildOpenCodeOpenArgs forces YOLO when the project has no local preference", () => {
  const projectRoot = tempProject();
  assert.deepEqual(buildOpenCodeOpenArgs({ projectRoot }), ["--agent", "YOLO"]);
});

test("buildOpenCodeOpenArgs respects project opencode default_agent", () => {
  const projectRoot = tempProject();
  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), '{ "default_agent": "agent" }\n');

  assert.deepEqual(projectOpenCodeAgentPreference(projectRoot), { agent: "agent", source: "opencode.jsonc" });
  assert.deepEqual(buildOpenCodeOpenArgs({ projectRoot }), ["--agent", "agent"]);
});

test("buildOpenCodeOpenArgs respects OGB profile defaultAgent when no OpenCode config is present", () => {
  const projectRoot = tempProject();
  fs.mkdirSync(path.join(projectRoot, ".opencode"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, ".opencode", "ogb.config.jsonc"), '{ "openCode": { "defaultAgent": "Research" } }\n');

  assert.deepEqual(projectOpenCodeAgentPreference(projectRoot), { agent: "Research", source: ".opencode/ogb.config.jsonc" });
  assert.deepEqual(buildOpenCodeOpenArgs({ projectRoot }), ["--agent", "Research"]);
});

test("resolveOpenCodeOpenAgent lets explicit CLI options override project preferences", () => {
  const projectRoot = tempProject();
  fs.writeFileSync(path.join(projectRoot, "opencode.jsonc"), '{ "default_agent": "agent" }\n');

  assert.deepEqual(resolveOpenCodeOpenAgent({ projectRoot, yolo: true }), { agent: "YOLO", source: "--yolo" });
  assert.deepEqual(resolveOpenCodeOpenAgent({ projectRoot, agent: "Build" }), { agent: "Build", source: "--agent" });
});
