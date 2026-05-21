import assert from "node:assert/strict";
import test from "node:test";
import { bulletList, formatDuration, kvRow, padToColumn, sectionHeader, statusRow } from "./format.js";
import { ICONS, INK_COLORS, LABELS } from "./theme.js";

test("tone tokens stay aligned across icons, labels, and ink colors", () => {
  const tones = ["pass", "warn", "fail", "preview", "neutral"] as const;
  assert.deepEqual(Object.keys(ICONS).sort(), [...tones].sort());
  assert.deepEqual(Object.keys(LABELS).sort(), [...tones].sort());
  assert.deepEqual(Object.keys(INK_COLORS).sort(), [...tones].sort());
});

test("statusRow leads with the tone icon and a two-space indent", () => {
  assert.equal(statusRow("pass", "doctor"), "  ✓ doctor");
  assert.equal(statusRow("warn", "security", "1 finding"), "  ⚠ security  1 finding");
});

test("sectionHeader starts with a blank line so consecutive sections breathe", () => {
  assert.equal(sectionHeader("Checks"), "\nChecks");
});

test("kvRow pads the key to a fixed column", () => {
  assert.equal(kvRow("Project", "/tmp/foo"), "  Project     /tmp/foo");
  assert.equal(kvRow("Verylongkeyname", "v", 5), "  Verylongkeynamev");
});

test("bulletList prefixes every item with the neutral bullet", () => {
  assert.deepEqual(bulletList(["one", "two"]), ["  • one", "  • two"]);
});

test("padToColumn aligns column widths but leaves the last column untouched", () => {
  const rows = [["a", "long", "ok"], ["aa", "x", "warn"]];
  assert.deepEqual(padToColumn(rows), [
    "a   long  ok",
    "aa  x     warn",
  ]);
});

test("formatDuration uses ms under a second, then trimmed seconds", () => {
  assert.equal(formatDuration(0), "0ms");
  assert.equal(formatDuration(420), "420ms");
  assert.equal(formatDuration(1000), "1s");
  assert.equal(formatDuration(1500), "1.5s");
  assert.equal(formatDuration(12_345), "12s");
});
