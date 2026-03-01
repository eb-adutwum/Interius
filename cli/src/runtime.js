import net from "node:net";
import path from "node:path";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import {
  buildRequirementsContent,
  getProjectLogPath,
  getProjectRuntimePath,
} from "./project.js";

function fileExists(targetPath) {
  return access(targetPath, constants.F_OK).then(
    () => true,
    () => false,
  );
}

export function getVenvPythonPath(cwd) {
  return process.platform === "win32"
    ? path.join(cwd, ".venv", "Scripts", "python.exe")
    : path.join(cwd, ".venv", "bin", "python");
}

function resolveSystemPython() {
  const candidates =
    process.platform === "win32"
      ? [
          { command: "py", args: ["-3", "--version"] },
          { command: "python", args: ["--version"] },
          { command: "python3", args: ["--version"] },
        ]
      : [
          { command: "python3", args: ["--version"] },
          { command: "python", args: ["--version"] },
        ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, {
      stdio: "ignore",
      shell: false,
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error("Unable to find a Python interpreter. Install Python 3.10+ first.");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: options.stdio ?? "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(" ")}), exit code ${code}`));
    });
  });
}

export async function ensureLocalEnvironment({ cwd, dependencies, onProgress }) {
  const venvPython = getVenvPythonPath(cwd);
  if (!(await fileExists(venvPython))) {
    const systemPython = resolveSystemPython();
    onProgress?.(`Creating local virtual environment with ${systemPython.command}...`);
    await runCommand(systemPython.command, [...systemPython.args.slice(0, -1), "-m", "venv", ".venv"], {
      cwd,
    });
  }

  const requirementsPath = path.join(cwd, "requirements.txt");
  await writeFile(requirementsPath, buildRequirementsContent(dependencies), "utf8");

  onProgress?.("Installing Python dependencies locally...");
  await runCommand(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { cwd });
  await runCommand(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd });

  return {
    venvPython,
    requirementsPath,
  };
}

function findFreePort(start = 8000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(start, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : start;
      server.close(() => resolve(port));
    });
  });
}

export async function detectAppModule(cwd) {
  const appMain = path.join(cwd, "app", "main.py");
  if (await fileExists(appMain)) {
    return "app.main:app";
  }
  const mainPy = path.join(cwd, "main.py");
  if (await fileExists(mainPy)) {
    return "main:app";
  }
  throw new Error("Unable to detect a FastAPI entrypoint. Expected app/main.py or main.py.");
}

export async function stopLocalApp(cwd) {
  const runtimePath = getProjectRuntimePath(cwd);
  try {
    const raw = await readFile(runtimePath, "utf8");
    const runtime = JSON.parse(raw);
    if (runtime?.pid) {
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(runtime.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(runtime.pid, "SIGTERM");
      }
    }
    await rm(runtimePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry until deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

export async function startLocalApp({ cwd, dependencies, onProgress }) {
  await ensureLocalEnvironment({ cwd, dependencies, onProgress });
  await stopLocalApp(cwd);

  const venvPython = getVenvPythonPath(cwd);
  const moduleName = await detectAppModule(cwd);
  const port = await findFreePort(8000);
  const logPath = getProjectLogPath(cwd);
  await mkdir(path.dirname(logPath), { recursive: true });
  const logHandle = await open(logPath, "a");

  onProgress?.(`Starting local API with uvicorn (${moduleName})...`);
  const child = spawn(
    venvPython,
    ["-m", "uvicorn", moduleName, "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL:
          process.env.DATABASE_URL || `sqlite:///${path.join(cwd, ".interius", "runtime.db")}`,
        AUTH_DATABASE_URL:
          process.env.AUTH_DATABASE_URL || `sqlite:///${path.join(cwd, ".interius", "auth-runtime.db")}`,
        SECRET_KEY: process.env.SECRET_KEY || "interius-local-dev-secret",
        ACCESS_TOKEN_EXPIRE_MINUTES: process.env.ACCESS_TOKEN_EXPIRE_MINUTES || "60",
      },
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    },
  );

  child.unref();
  await logHandle.close();

  const swaggerUrl = `http://127.0.0.1:${port}/docs`;
  const openapiUrl = `http://127.0.0.1:${port}/openapi.json`;
  const ready = await waitForUrl(openapiUrl);
  if (!ready) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(child.pid, "SIGTERM");
    }
    const logs = await readRuntimeLogs(cwd);
    throw new Error(
      `Local app did not become ready in time.\n\nRecent logs:\n${logs || "(no logs yet)"}`,
    );
  }

  const runtime = {
    pid: child.pid,
    port,
    moduleName,
    swaggerUrl,
    python: venvPython,
    startedAt: new Date().toISOString(),
  };
  await writeFile(getProjectRuntimePath(cwd), `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  return runtime;
}

export async function readRuntime(cwd) {
  try {
    const raw = await readFile(getProjectRuntimePath(cwd), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function readRuntimeLogs(cwd) {
  try {
    return await readFile(getProjectLogPath(cwd), "utf8");
  } catch {
    return "";
  }
}

export async function getRuntimeStatus(cwd) {
  const runtime = await readRuntime(cwd);
  if (!runtime?.swaggerUrl) {
    return {
      runtime,
      ready: false,
    };
  }
  try {
    const response = await fetch(runtime.swaggerUrl);
    return {
      runtime,
      ready: response.ok,
    };
  } catch {
    return {
      runtime,
      ready: false,
    };
  }
}
