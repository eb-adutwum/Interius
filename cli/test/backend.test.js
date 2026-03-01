import test from "node:test";
import assert from "node:assert/strict";

import { streamBuild } from "../src/backend.js";

test("streamBuild sends local_cli runtime mode", async () => {
  let capturedBody = null;
  global.fetch = async (_url, options) => {
    capturedBody = JSON.parse(String(options?.body || "{}"));
    return {
      ok: true,
      body: {
        getReader() {
          return {
            async read() {
              return { done: true, value: undefined };
            },
          };
        },
      },
    };
  };

  await streamBuild({
    backendUrl: "http://localhost:8000",
    token: "",
    threadId: "thread-123",
    prompt: "Build a todo API",
    recentMessages: [],
    attachmentSummaries: [],
    threadContextFiles: [],
    onEvent: async () => {},
  });

  assert.equal(capturedBody.runtime_mode, "local_cli");
});
