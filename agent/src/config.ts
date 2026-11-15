/**
 * Where Tomari lives on disk (Windows). The data dir holds config.json with the pairing token (created on
 * first run), tomari.db the SQLite store, and bin/ the binaries autostart runs. The overlay reads the token too.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOOK_PORT = 7777;

const HOME = homedir();
const LOCAL = process.env.LOCALAPPDATA ?? join(HOME, "AppData", "Local");
export const DATA_DIR = join(LOCAL, "tomari");
export const BIN_DIR = join(DATA_DIR, "bin");
export const LOG_DIR = join(DATA_DIR, "logs");
export const CLAUDE_SETTINGS = join(HOME, ".claude", "settings.json");
export const CONFIG_FILE = join(DATA_DIR, "config.json");
export const DB_FILE = join(DATA_DIR, "tomari.db");
/** Claude desktop (MSIX) keeps its data in Claude-Data\claude_<package id>; its logs in Claude\logs. */
export const CLAUDE_DATA_ROOT = join(LOCAL, "Claude-Data");
export const CLAUDE_DESKTOP_LOG = join(LOCAL, "Claude", "logs", "main.log");
/** Antigravity's language servers write one hub_<port>.json per instance here. */
export const ANTIGRAVITY_DAEMON_DIR = join(HOME, ".gemini", "antigravity", "daemon");
export const ANTIGRAVITY_EXE = join(LOCAL, "Programs", "antigravity", "Antigravity.exe");
/** Grok Bot (Electron) keeps its data, including a cached agent list, in %APPDATA%\Grok Bot. */
export const GROK_DATA_DIR = join(process.env.APPDATA ?? join(HOME, "AppData", "Roaming"), "Grok Bot");

/** The Claude CLI: the native installer's copy first, since the login-time PATH may not include ~/.local/bin. */
export function claudeBin(): string {
  const native = join(HOME, ".local", "bin", "claude.exe");
  return existsSync(native) ? native : (Bun.which("claude") ?? "claude");
}

export interface Config {
  dataDir: string;
  dbPath: string;
  token: string;
}

export async function loadConfig(): Promise<Config> {
  await mkdir(DATA_DIR, { recursive: true });
  const file = Bun.file(CONFIG_FILE);
  const saved: { token?: string } = (await file.exists()) ? await file.json() : {};
  if (!saved.token) {
    saved.token = randomBytes(24).toString("base64url");
    await Bun.write(CONFIG_FILE, JSON.stringify(saved, null, 2) + "\n");
  }
  return { dataDir: DATA_DIR, dbPath: DB_FILE, token: saved.token };
}
