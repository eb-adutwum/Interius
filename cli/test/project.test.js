import test from "node:test";
import assert from "node:assert/strict";

import { buildRequirementsContent } from "../src/project.js";

test("buildRequirementsContent includes baseline deps and dedupes input", () => {
  const content = buildRequirementsContent(["uvicorn[standard]", "httpx", "fastapi"]);
  const lines = content.trim().split("\n");
  assert.deepEqual(lines, ["fastapi", "httpx", "sqlmodel", "uvicorn[standard]"]);
});
