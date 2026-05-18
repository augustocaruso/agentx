import assert from "node:assert/strict";
import test from "node:test";
import { windowsAttribOutputHasReadOnly } from "./windows-attributes.js";

test("windowsAttribOutputHasReadOnly recognizes the attrib R flag", () => {
  assert.equal(windowsAttribOutputHasReadOnly("     R               C:\\Users\\leo\\.config\\opencode"), true);
  assert.equal(windowsAttribOutputHasReadOnly("                     C:\\Users\\leo\\.config\\opencode"), false);
  assert.equal(windowsAttribOutputHasReadOnly("A                    C:\\Users\\leo\\.config\\opencode"), false);
});
