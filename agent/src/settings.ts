import { copyFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CLAUDE_SETTINGS } from "./config.ts";
import { hasPanelHooks, mergeHooks, type Settings } from "./hooks-config.ts";

const KEEP_BACKUPS = 3;

/** Parses settings text; tolerates the BOM some Windows editors add. */
export function parseSettings(text: string, path = CLAUDE_SETTINGS): Settings {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, "")) as Settings;
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err instanceof Error ? err.message : err}); fix it and run setup again`);
  }
}

async function readSettings(path = CLAUDE_SETTINGS): Promise<Settings> {
  const file = Bun.file(path);
  return (await file.exists()) ? parseSettings(await file.text(), path) : {};
}

/** Adds or removes our hooks in settings.json, backing the file up first. False when nothing changed. */
export async function writeHooks({ install, path = CLAUDE_SETTINGS }: { install: boolean; path?: string }): Promise<boolean> {
  const exists = await Bun.file(path).exists();
  const before = await readSettings(path);
  const after = mergeHooks(before, { install });
  if (JSON.stringify(after) === JSON.stringify(before)) return false;
  if (exists) {
    await copyFile(path, `${path}.bak-tomari-${Date.now()}`);
    await pruneBackups(path);
  }
  // Write then rename: a crash mid-write never leaves Claude Code with a half-written settings file.
  const tmp = `${path}.tomari-tmp`;
  await Bun.write(tmp, JSON.stringify(after, null, 2) + "\n");
  await rename(tmp, path);
  return true;
}

/** Keeps the newest KEEP_BACKUPS of our backups. */
async function pruneBackups(path: string) {
  const prefix = `${basename(path)}.bak-tomari-`;
  const dir = dirname(path);
  const ours = (await readdir(dir)).filter((n) => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)));
  ours.sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
  for (const name of ours.slice(KEEP_BACKUPS)) await rm(join(dir, name), { force: true });
}

export async function hooksInstalled() {
  return hasPanelHooks(await readSettings());
}
