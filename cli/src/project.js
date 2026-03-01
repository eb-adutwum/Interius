import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";

const PROJECT_STATE_DIR = ".interius";
const PROJECT_STATE_FILE = "project.json";
const PROJECT_RUNTIME_FILE = "runtime.json";
const PROJECT_LOG_FILE = "runtime.log";
const ARTIFACT_DIR = "artifacts";
const BACKUP_DIR = "backups";

const IGNORED_DIRS = new Set([
  ".git",
  ".idea",
  ".interius",
  ".venv",
  "node_modules",
  "dist",
  "build",
  "__pycache__",
]);

const TEXT_EXTENSIONS = new Set([
  ".env",
  ".json",
  ".jsx",
  ".js",
  ".md",
  ".py",
  ".sql",
  ".text",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export function getProjectStateDir(cwd) {
  return path.join(cwd, PROJECT_STATE_DIR);
}

export function getProjectStatePath(cwd) {
  return path.join(getProjectStateDir(cwd), PROJECT_STATE_FILE);
}

export function getProjectRuntimePath(cwd) {
  return path.join(getProjectStateDir(cwd), PROJECT_RUNTIME_FILE);
}

export function getProjectLogPath(cwd) {
  return path.join(getProjectStateDir(cwd), PROJECT_LOG_FILE);
}

export function getArtifactDir(cwd) {
  return path.join(getProjectStateDir(cwd), ARTIFACT_DIR);
}

export function getBackupRoot(cwd) {
  return path.join(getProjectStateDir(cwd), BACKUP_DIR);
}

export async function ensureProjectStateDir(cwd) {
  await mkdir(getProjectStateDir(cwd), { recursive: true });
}

export async function loadProjectState(cwd) {
  try {
    const raw = await readFile(getProjectStatePath(cwd), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveProjectState(cwd, state) {
  await ensureProjectStateDir(cwd);
  await writeFile(getProjectStatePath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function getOrCreateProjectState(cwd) {
  const existing = await loadProjectState(cwd);
  if (existing?.threadId) {
    return existing;
  }
  const state = {
    threadId: crypto.randomUUID(),
    recentMessages: [],
    lastSwaggerUrl: "",
  };
  await saveProjectState(cwd, state);
  return state;
}

export async function saveArtifact(cwd, name, value) {
  if (!value) {
    return;
  }
  const artifactDir = getArtifactDir(cwd);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

export function buildRequirementsContent(dependencies) {
  const baseline = new Set(["fastapi", "uvicorn[standard]", "sqlmodel"]);
  for (const dependency of dependencies || []) {
    if (dependency && String(dependency).trim()) {
      baseline.add(String(dependency).trim());
    }
  }
  return `${Array.from(baseline).sort().join("\n")}\n`;
}

async function walkDirectory(rootDir, relativeDir = "") {
  const absoluteDir = path.join(rootDir, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const relativePath = path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDirectory(rootDir, relativePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function looksTextual(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || path.basename(filePath).toLowerCase() === "dockerfile";
}

export async function collectProjectContext(cwd, options = {}) {
  const maxFiles = options.maxFiles ?? 60;
  const maxFileBytes = options.maxFileBytes ?? 20_000;
  const maxTotalBytes = options.maxTotalBytes ?? 300_000;
  const files = await walkDirectory(cwd);
  let totalBytes = 0;
  const threadContextFiles = [];
  const attachmentSummaries = [];

  for (const relativePath of files.sort()) {
    if (threadContextFiles.length >= maxFiles || totalBytes >= maxTotalBytes) {
      break;
    }

    const absolutePath = path.join(cwd, relativePath);
    const metadata = await stat(absolutePath);
    const isText = looksTextual(relativePath) && metadata.size <= maxFileBytes;
    let textContent = null;
    let excerpt = null;

    if (isText) {
      try {
        textContent = await readFile(absolutePath, "utf8");
        if (Buffer.byteLength(textContent, "utf8") > maxFileBytes) {
          textContent = textContent.slice(0, maxFileBytes);
        }
        excerpt = textContent.slice(0, 240);
        totalBytes += Buffer.byteLength(textContent, "utf8");
      } catch {
        textContent = null;
      }
    }

    threadContextFiles.push({
      filename: relativePath,
      mime_type: null,
      size_bytes: metadata.size,
      has_text_content: Boolean(textContent),
      text_content: textContent,
    });
    attachmentSummaries.push({
      filename: relativePath,
      mime_type: null,
      size_bytes: metadata.size,
      text_excerpt: excerpt,
      has_text_content: Boolean(textContent),
    });
  }

  return {
    threadContextFiles,
    attachmentSummaries,
  };
}
