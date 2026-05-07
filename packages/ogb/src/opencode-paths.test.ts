import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { globalOpenCodeConfigDir, globalOpenCodeConfigFiles, legacyWindowsAppDataOpenCodeConfigDir } from "./opencode-paths.js";

test("opencode paths delegate Windows global and legacy roots to the platform adapter", () => {
  const homeDir = "C:\\Users\\leona";
  const env = { APPDATA: "C:\\Users\\leona\\AppData\\Roaming" };

  assert.equal(
    globalOpenCodeConfigDir({ homeDir, platform: "win32", env }),
    "C:\\Users\\leona\\.config\\opencode",
  );
  assert.deepEqual(
    globalOpenCodeConfigFiles({ homeDir, platform: "win32", env }),
    [
      "C:\\Users\\leona\\.config\\opencode\\opencode.json",
      "C:\\Users\\leona\\.config\\opencode\\opencode.jsonc",
    ],
  );
  assert.equal(
    legacyWindowsAppDataOpenCodeConfigDir({ homeDir, platform: "win32", env }),
    "C:\\Users\\leona\\AppData\\Roaming\\opencode",
  );
});

test("opencode paths preserve POSIX fixtures while simulating Windows", () => {
  const homeDir = path.join(os.tmpdir(), "ogb-opencode-paths-home");

  assert.equal(
    globalOpenCodeConfigDir({ homeDir, platform: "win32", env: {} }),
    path.join(homeDir, ".config", "opencode"),
  );
  assert.equal(
    legacyWindowsAppDataOpenCodeConfigDir({ homeDir, platform: "win32", env: {} }),
    path.join(homeDir, "AppData", "Roaming", "opencode"),
  );
});
