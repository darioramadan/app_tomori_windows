/**
 * Grok Bot agents as sessions. The app (Electron) caches its sidebar in
 * %APPDATA%\Grok Bot\sand-client-persistence\<base32 key>.blob; the key ending in ".roster.last-roster"
 * holds {value: {rows: [...]}}, one row per agent. desktop-status.json gives the running app's pid.
 * Both are undocumented. The cache is written when the app feels like it, so states lag a little, and
 * "working" is not in it: an agent shows as waiting on you, done (unread) or idle.
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessionState } from "../../shared/protocol.ts";
import { GROK_DATA_DIR } from "./config.ts";
import type { SessionHub } from "./hub.ts";
import { isAlive } from "./open-session.ts";
import { isSessionId } from "./protocol-guard.ts";
import type { SessionRecord } from "./state.ts";

export interface GrokAgent {
  id: string;
  name?: string;
  title?: string;
  isGroup?: boolean;
  isHiddenFromSidebar?: boolean;
  isRemovedFromSidebar?: boolean;
  awaitingUserResponse?: unknown;
  hasUnread?: boolean;
  lastActivityAt?: number;
}

const ROSTER_SUFFIX = ".roster.last-roster";

/** The blob's key: its file name is the key in unpadded lowercase base32. */
export function blobKey(fileName: string): string | null {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of fileName.replace(/\.blob$/, "")) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Agents in the newest cached roster (one per signed-in account); [] if there is none. */
export async function readRoster(dir = GROK_DATA_DIR): Promise<GrokAgent[]> {
  const folder = join(dir, "sand-client-persistence");
  let newest: { path: string; mtime: number } | null = null;
  for (const name of await readdir(folder).catch(() => [] as string[])) {
    if (!name.endsWith(".blob") || !blobKey(name)?.endsWith(ROSTER_SUFFIX)) continue;
    const path = join(folder, name);
    const mtime = (await stat(path).catch(() => null))?.mtimeMs ?? 0;
    if (!newest || mtime > newest.mtime) newest = { path, mtime };
  }
  if (!newest) return [];
  const blob = await Bun.file(newest.path).json().catch(() => null);
  const rows: unknown = blob?.value?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is GrokAgent => isSessionId(r?.id) && !r.isGroup && !r.isHiddenFromSidebar && !r.isRemovedFromSidebar);
}

/** Whether Grok Bot is running, from the pid it records at start. */
export async function grokRunning(dir = GROK_DATA_DIR, alive: (pid: number) => boolean = isAlive): Promise<boolean> {
  const status = await Bun.file(join(dir, "desktop-status.json")).json().catch(() => null);
  return Number.isInteger(status?.pid) && alive(status.pid);
}

export function stateOf(a: GrokAgent): SessionState {
  if (a.awaitingUserResponse) return "needs_input";
  return a.hasUnread ? "done" : "idle";
}

export function toRecord(a: GrokAgent, prev: SessionRecord | undefined, now: number): SessionRecord {
  const state = stateOf(a);
  const changed = !prev || prev.state !== state || !prev.live;
  return {
    id: a.id,
    name: a.name || a.title || null,
    cwd: "", // agents run in Grok's cloud box: no local folder
    state,
    activity: state === "needs_input" ? "Waiting for your answer" : null,
    live: true,
    pid: null,
    stateSince: changed ? (state === "needs_input" ? now : a.lastActivityAt || now) : prev!.stateSince,
    lastEventAt: a.lastActivityAt || now,
    source: "grok",
    project: "Grok",
  };
}

/** Polls Grok Bot's cache into the hub; with the app closed, its sessions end. Returns a stop function. */
export function startGrokPoller(
  hub: SessionHub,
  { intervalMs = 5000, running = () => grokRunning(), roster = () => readRoster(), now = Date.now } = {},
) {
  let stopped = false;
  let lastError = "";
  (async () => {
    while (!stopped) {
      try {
        const agents = (await running()) ? await roster() : [];
        hub.syncSource("grok", agents.map((a) => toRecord(a, hub.record(a.id), now())));
        lastError = "";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastError) console.error(`grok poll failed: ${message}`);
        lastError = message;
      }
      await Bun.sleep(intervalMs);
    }
  })();
  return () => {
    stopped = true;
  };
}
