import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(srcDir, relPath), "utf8");
}

test("cli loads Ink UI modules only through dynamic imports", () => {
  const source = readSource("cli.ts");

  assert.doesNotMatch(source, /from\s+["'](?:\.\/)?(?:help-ui|ritual-ui)\.js["']/);
  assert.doesNotMatch(source, /from\s+["']\.\/ui\/ink\/(?:help-ui|ritual-ui)\.js["']/);
  assert.doesNotMatch(source, /from\s+["'](?:ink|react)["']/);
  assert.match(source, /import\(["']\.\/ui\/ink\/ritual-ui\.js["']\)/);
  assert.match(source, /import\(["']\.\/ui\/ink\/help-ui\.js["']\)/);
});

test("ritual view model stays free of React and Ink runtime imports", () => {
  const source = readSource("ritual-view-model.ts");

  assert.doesNotMatch(source, /from\s+["'](?:ink|react)["']/);
  assert.doesNotMatch(source, /React\.createElement|render\(/);
});

test("OpenCode TUI source is isolated from the sidebar installer adapter", () => {
  const adapter = readSource("tui-sidebar.ts");
  const source = readSource("tui-sidebar-source.ts");

  assert.doesNotMatch(adapter, /String\.raw`import fs from "node:fs"/);
  assert.match(adapter, /from\s+["']\.\/tui-sidebar-source\.js["']/);
  assert.match(source, /export const TUI_SIDEBAR_PLUGIN_SOURCE = String\.raw`import fs from "node:fs"/);
});

test("presentation theme and format modules stay free of React and Ink", () => {
  for (const file of ["presentation/theme.ts", "presentation/format.ts"]) {
    const source = readSource(file);
    assert.doesNotMatch(source, /from\s+["'](?:ink|react)["']/, `${file} must not import ink/react`);
    assert.doesNotMatch(source, /React\.createElement|render\(/, `${file} must not invoke React/Ink runtime`);
  }
});
