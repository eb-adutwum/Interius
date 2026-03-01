import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { getVenvPythonPath } from "../src/runtime.js";

test("getVenvPythonPath resolves platform-specific interpreter path", () => {
  const result = getVenvPythonPath(path.join(os.tmpdir(), "interius-cli"));
  if (process.platform === "win32") {
    assert.match(result, /\\\.venv\\Scripts\\python\.exe$/);
    return;
  }
  assert.match(result, /\/\.venv\/bin\/python$/);
});
