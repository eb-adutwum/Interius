import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";

import { streamBuild } from "./backend.js";
import { loadConfig, saveConfig } from "./config.js";
import {
  collectProjectContext,
  ensureProjectStateDir,
  getBackupRoot,
  getOrCreateProjectState,
  saveArtifact,
  saveProjectState,
} from "./project.js";
import { getRuntimeStatus, readRuntimeLogs, startLocalApp, stopLocalApp } from "./runtime.js";

function printHelp() {
  console.log(`Interius CLI

Usage:
  interius login [backend-url]
  interius build "<prompt>"
  interius status
  interius stop
  interius logs

Shortcuts:
  interius "<prompt>"   Build directly from the current folder.

Environment:
  INTERIUS_BACKEND_URL  Override the backend base URL.
  INTERIUS_TOKEN        Optional bearer token for backend requests.
`);
}

function colorize(kind, text) {
  const colors = {
    blue: "\u001b[34m",
    cyan: "\u001b[36m",
    gray: "\u001b[90m",
    green: "\u001b[32m",
    red: "\u001b[31m",
    yellow: "\u001b[33m",
  };
  const reset = "\u001b[0m";
  return `${colors[kind] || ""}${text}${reset}`;
}

function logStep(message) {
  console.log(colorize("cyan", `> ${message}`));
}

function logSuccess(message) {
  console.log(colorize("green", `✓ ${message}`));
}

function logWarning(message) {
  console.log(colorize("yellow", `! ${message}`));
}

function normalizeArgs(argv) {
  if (!argv.length) {
    return { command: "help", rest: [] };
  }
  const [first, ...rest] = argv;
  if (["login", "build", "status", "stop", "logs", "--help", "-h", "help"].includes(first)) {
    return {
      command: first === "--help" || first === "-h" ? "help" : first,
      rest,
    };
  }
  return {
    command: "build",
    rest: argv,
  };
}

async function promptLogin(existingConfig) {
  const rl = readline.createInterface({ input, output });
  try {
    const backendUrl =
      (await rl.question(
        `Backend URL [${existingConfig.backendUrl || "http://localhost:8000"}]: `,
      )).trim() || existingConfig.backendUrl || "http://localhost:8000";
    const token =
      (await rl.question(
        `Bearer token [${existingConfig.token ? "saved" : "optional"}]: `,
      )).trim() || existingConfig.token || "";
    return { backendUrl, token };
  } finally {
    rl.close();
  }
}

async function backupFile(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  try {
    await stat(absolutePath);
  } catch {
    return;
  }

  const backupRoot = path.join(
    getBackupRoot(cwd),
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  const backupPath = path.join(backupRoot, relativePath);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(absolutePath, backupPath);
}

async function writeGeneratedFiles({ cwd, files, dependencies }) {
  let writtenCount = 0;
  for (const file of files || []) {
    const relativePath = String(file?.path || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relativePath) {
      continue;
    }
    const destination = path.join(cwd, relativePath);
    await backupFile(cwd, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, String(file?.content || ""), "utf8");
    writtenCount += 1;
  }
  if (dependencies?.length) {
    await backupFile(cwd, "requirements.txt");
    await writeFile(
      path.join(cwd, "requirements.txt"),
      `${Array.from(new Set(["fastapi", "uvicorn[standard]", "sqlmodel", ...dependencies])).sort().join("\n")}\n`,
      "utf8",
    );
  }
  return writtenCount;
}

async function handleBuild(promptText) {
  const prompt = String(promptText || "").trim();
  if (!prompt) {
    throw new Error('Provide a prompt, for example: interius build "Build a todo API"');
  }

  const cwd = process.cwd();
  const config = await loadConfig();
  const projectState = await getOrCreateProjectState(cwd);
  const context = await collectProjectContext(cwd);

  logStep(`Using backend ${config.backendUrl}`);
  logStep(`Scanning local workspace: ${cwd}`);
  logSuccess(
    `Loaded ${context.threadContextFiles.length} file(s) of local context for thread ${projectState.threadId}`,
  );

  const recentMessages = Array.isArray(projectState.recentMessages)
    ? projectState.recentMessages.slice(-12)
    : [];

  let generatedFiles = [];
  let dependencies = [];
  let completionSummary = "";
  let chatOnlyReply = "";
  let lastErrorArtifact = null;
  let requirementsArtifact = null;
  let architectureArtifact = null;
  const startedStages = new Set();

  await streamBuild({
    backendUrl: config.backendUrl,
    token: config.token,
    threadId: projectState.threadId,
    prompt,
    recentMessages,
    attachmentSummaries: context.attachmentSummaries,
    threadContextFiles: context.threadContextFiles,
    onEvent: async (event) => {
      const status = event?.status;
      if (!status) {
        return;
      }
      if (status === "intent_routed") {
        logStep(event.message || "Interius started generation.");
        return;
      }
      if (status === "chat_reply") {
        chatOnlyReply = String(event.message || "").trim();
        console.log(chatOnlyReply);
        return;
      }
      if (status === "stage_started") {
        const stageKey = String(event.stage || "").trim();
        if (stageKey && !startedStages.has(stageKey)) {
          startedStages.add(stageKey);
          logStep(`${event.stage}: ${event.message || "running"}`);
        }
        return;
      }
      if (status === "stage_completed") {
        logSuccess(`${event.stage} completed`);
        return;
      }
      if (status === "artifact_requirements") {
        requirementsArtifact = event.artifact || null;
        await saveArtifact(cwd, "requirements-artifact.json", requirementsArtifact);
        logSuccess("Captured requirements artifact");
        return;
      }
      if (status === "artifact_architecture") {
        architectureArtifact = event.artifact || null;
        await saveArtifact(cwd, "architecture-artifact.json", architectureArtifact);
        logSuccess("Captured architecture artifact");
        return;
      }
      if (status === "review_update") {
        const kind = String(event.kind || "").trim();
        if (kind === "completed" || kind === "failed" || kind === "repair_completed") {
          logStep(event.message || `${kind} update`);
        }
        return;
      }
      if (status === "artifact_files") {
        generatedFiles = Array.isArray(event.files) ? event.files : [];
        dependencies = Array.isArray(event.dependencies) ? event.dependencies : [];
        const writtenCount = await writeGeneratedFiles({
          cwd,
          files: generatedFiles,
          dependencies,
        });
        logSuccess(`Wrote ${writtenCount} generated file(s) into the current project folder`);
        return;
      }
      if (status === "completed") {
        completionSummary =
          String(event.summary || event.message || "Pipeline completed successfully.").trim();
        logSuccess(completionSummary);
        return;
      }
      if (status === "error") {
        lastErrorArtifact = event.artifact || null;
        if (lastErrorArtifact) {
          await saveArtifact(cwd, "last-error-artifact.json", lastErrorArtifact);
        }
        const repairSummary = String(
          lastErrorArtifact?.repair?.summary ||
            lastErrorArtifact?.summary ||
            event.message ||
            "The generation pipeline failed.",
        ).trim();
        throw new Error(repairSummary);
      }
    },
  });

  if (chatOnlyReply && !generatedFiles.length) {
    projectState.recentMessages = [
      ...recentMessages,
      { role: "user", content: prompt },
      { role: "assistant", content: chatOnlyReply },
    ].slice(-12);
    await saveProjectState(cwd, projectState);
    return;
  }

  if (!generatedFiles.length) {
    throw new Error("No generated files were returned by the backend.");
  }

  const runtime = await startLocalApp({
    cwd,
    dependencies,
    onProgress: logStep,
  });

  projectState.recentMessages = [
    ...recentMessages,
    { role: "user", content: prompt },
    { role: "agent", content: completionSummary || `Local app is running at ${runtime.swaggerUrl}` },
  ].slice(-12);
  projectState.lastSwaggerUrl = runtime.swaggerUrl;
  await saveProjectState(cwd, projectState);
  await ensureProjectStateDir(cwd);

  logSuccess(`Local API is running at ${runtime.swaggerUrl}`);
  console.log(colorize("gray", `Thread: ${projectState.threadId}`));
}

async function handleLogin(urlArg) {
  const existingConfig = await loadConfig();
  const config = urlArg
    ? {
        backendUrl: String(urlArg).trim(),
        token: existingConfig.token || "",
      }
    : await promptLogin(existingConfig);
  await saveConfig(config);
  logSuccess(`Saved CLI configuration to backend ${config.backendUrl}`);
}

async function handleStatus() {
  const status = await getRuntimeStatus(process.cwd());
  if (!status.runtime) {
    logWarning("No local Interius-managed app is running in this folder.");
    return;
  }
  console.log(`PID: ${status.runtime.pid}`);
  console.log(`Module: ${status.runtime.moduleName}`);
  console.log(`Swagger UI: ${status.runtime.swaggerUrl}`);
  console.log(`Ready: ${status.ready ? "yes" : "no"}`);
}

async function handleStop() {
  const stopped = await stopLocalApp(process.cwd());
  if (!stopped) {
    logWarning("No local Interius-managed process was found.");
    return;
  }
  logSuccess("Stopped the local Interius-managed API process.");
}

async function handleLogs() {
  const logs = await readRuntimeLogs(process.cwd());
  if (!logs.trim()) {
    logWarning("No runtime logs found yet.");
    return;
  }
  process.stdout.write(logs);
}

export async function main(argv) {
  const { command, rest } = normalizeArgs(argv);
  if (command === "help") {
    printHelp();
    return;
  }
  if (command === "login") {
    await handleLogin(rest[0]);
    return;
  }
  if (command === "status") {
    await handleStatus();
    return;
  }
  if (command === "stop") {
    await handleStop();
    return;
  }
  if (command === "logs") {
    await handleLogs();
    return;
  }
  if (command === "build") {
    await handleBuild(rest.join(" "));
    return;
  }
  printHelp();
}
