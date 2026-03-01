import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONFIG_DIR = path.join(os.homedir(), ".interius");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function getConfigPath() {
  return CONFIG_PATH;
}

export async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {
      backendUrl: process.env.INTERIUS_BACKEND_URL || "http://localhost:8000",
      token: process.env.INTERIUS_TOKEN || "",
    };
  }
}

export async function saveConfig(config) {
  await ensureConfigDir();
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
