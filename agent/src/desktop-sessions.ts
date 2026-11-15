/**
 * Sessions known to the Claude desktop app, from its metadata files (undocumented):
 * %LOCALAPPDATA%\Claude-Data\claude_<package>\claude-code-sessions\<account>\<org>\local_<id>.json.
 * They outlive the CLI process, which the app stops when a session sits idle.
 * The app's project groups (Work, Home…) live in claude_desktop_config.json next to that folder.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_DATA_ROOT } from "./config.ts";
import { isSessionId } from "./protocol-guard.ts";

/** The desktop app's data folder (Claude-Data\claude_<package id>), or a path that doesn't exist. */
export function desktopAppDir(root = CLAUDE_DATA_ROOT): string {
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {}
  const found = names.find((name) => name.startsWith("claude_") && existsSync(join(root, name, "claude-code-sessions")));
  return join(root, found ?? "claude_missing");
}

/** Resolved on every call: the desktop app may be installed or first run after the agent starts. */
export const desktopSessionsDir = () => join(desktopAppDir(), "claude-code-sessions");

/** Without its sessions dir there is no desktop app to open sessions in. */
export function hasDesktopApp(dir = desktopSessionsDir()) {
  return existsSync(dir);
}

/**
 * Cached `hasDesktopApp`: the + menu and the focus watchers ask often, and the answer rarely changes.
 * Re-checked every `ttlMs`, so installing the desktop app later still works without a restart.
 */
export function desktopProbe({ dir, ttlMs = 5 * 60_000, now = Date.now, exists = existsSync }: { dir?: string; ttlMs?: number; now?: () => number; exists?: (path: string) => boolean } = {}) {
  let checkedAt = -Infinity;
  let present = false;
  return () => {
    if (now() - checkedAt >= ttlMs) {
      present = exists(dir ?? desktopSessionsDir());
      checkedAt = now();
    }
    return present;
  };
}

/** The agent's shared probe. */
export const desktopPresent = desktopProbe();

/** `list`, skipped (no directory scan) while the probe says there is no desktop app. */
export function desktopSessionsLister(probe: () => boolean = desktopPresent, list: () => Promise<DesktopSession[]> = () => listDesktopSessions()) {
  return async (): Promise<DesktopSession[]> => (probe() ? list() : []);
}

export interface DesktopSession {
  /** The app's id, used in claude:// links. */
  localId: string;
  /** The CLI session id that hooks and `claude agents` report. */
  sessionId: string;
  title: string | null;
  cwd: string;
  lastActivityAt: number;
  archived: boolean;
  /** The app's project group, e.g. "Work"; null when ungrouped. */
  project: string | null;
}

/**
 * `local_…` id → project name, from the app's sidebar groups (undocumented):
 * preferences.epitaxyPrefs["dframe-group-scopes"][*] = { groups: [{id, name}], assignments: {"code:local_…": groupId} }.
 */
export function projectsFrom(config: unknown): Map<string, string> {
  const projects = new Map<string, string>();
  const scopes = (config as any)?.preferences?.epitaxyPrefs?.["dframe-group-scopes"];
  if (!scopes || typeof scopes !== "object") return projects;
  for (const scope of Object.values(scopes) as any[]) {
    const names = new Map<string, string>();
    for (const g of Array.isArray(scope?.groups) ? scope.groups : []) {
      if (typeof g?.id === "string" && typeof g?.name === "string") names.set(g.id, g.name);
    }
    for (const [key, groupId] of Object.entries(scope?.assignments ?? {})) {
      const name = names.get(String(groupId));
      if (name && key.startsWith("code:local_")) projects.set(key.slice("code:".length), name);
    }
  }
  return projects;
}

export async function desktopProjects(path = join(desktopAppDir(), "claude_desktop_config.json")): Promise<Map<string, string>> {
  return projectsFrom(await Bun.file(path).json().catch(() => null));
}

/** Every desktop session, most recently active first. */
export async function listDesktopSessions(dir = desktopSessionsDir(), configPath = join(dir, "..", "claude_desktop_config.json")): Promise<DesktopSession[]> {
  const sessions: DesktopSession[] = [];
  const projects = await desktopProjects(configPath);
  for await (const path of scan("*/*/local_*.json", dir)) {
    const session = parse(await Bun.file(path).json().catch(() => null));
    if (session) sessions.push({ ...session, project: projects.get(session.localId) ?? null });
  }
  return sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export async function findDesktopSession(sessionId: string, dir = desktopSessionsDir()): Promise<DesktopSession | undefined> {
  return (await listDesktopSessions(dir)).find((s) => s.sessionId === sessionId);
}

/** CLI session id of a desktop `local_…` session. */
export async function cliSessionIdFor(localId: string, dir = desktopSessionsDir()): Promise<string | null> {
  for await (const path of scan(`*/*/${localId}.json`, dir)) {
    const session = parse(await Bun.file(path).json().catch(() => null));
    if (session) return session.sessionId;
  }
  return null;
}

/** Files matching `pattern` under `dir`. A missing dir (no desktop app) has none. */
async function* scan(pattern: string, dir: string) {
  try {
    yield* new Bun.Glob(pattern).scan({ cwd: dir, absolute: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
}

function parse(meta: Record<string, unknown> | null): DesktopSession | null {
  if (!meta || typeof meta.sessionId !== "string" || !meta.sessionId.startsWith("local_")) return null;
  if (!isSessionId(meta.cliSessionId)) return null;
  return {
    localId: meta.sessionId,
    sessionId: meta.cliSessionId,
    title: typeof meta.title === "string" ? meta.title : null,
    cwd: typeof meta.cwd === "string" ? meta.cwd : "",
    lastActivityAt: typeof meta.lastActivityAt === "number" ? meta.lastActivityAt : 0,
    archived: meta.isArchived === true,
    project: null,
  };
}
