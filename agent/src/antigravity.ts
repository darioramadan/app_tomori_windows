/**
 * Antigravity conversations as sessions. Each running Antigravity has a local language server that
 * writes ~/.gemini/antigravity/daemon/hub_<port>.json ({pid, httpPort, csrfToken}); its undocumented
 * Connect API `GetAllCascadeTrajectories` lists the loaded conversations with their run status.
 * If the API changes or Antigravity isn't running, Antigravity sessions just end.
 */
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionState } from "../../shared/protocol.ts";
import { ANTIGRAVITY_DAEMON_DIR } from "./config.ts";
import { isAlive } from "./open-session.ts";
import type { SessionHub } from "./hub.ts";
import type { SessionRecord } from "./state.ts";

const METHOD = "exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories";

export interface DaemonHub {
  pid: number;
  httpPort: number;
  csrfToken: string;
}

/** Hub files whose language server is still running. */
export async function liveHubs(dir = ANTIGRAVITY_DAEMON_DIR, alive: (pid: number) => boolean = isAlive): Promise<DaemonHub[]> {
  const hubs: DaemonHub[] = [];
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!/^hub_\d+\.json$/.test(name)) continue;
    const hub = await Bun.file(join(dir, name)).json().catch(() => null);
    if (hub && Number.isInteger(hub.pid) && Number.isInteger(hub.httpPort) && typeof hub.csrfToken === "string" && alive(hub.pid)) hubs.push(hub);
  }
  return hubs;
}

export async function fetchTrajectories(hub: DaemonHub): Promise<Record<string, Trajectory>> {
  const res = await fetch(`http://127.0.0.1:${hub.httpPort}/${METHOD}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1", "X-Codeium-Csrf-Token": hub.csrfToken },
    body: "{}",
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`antigravity ${res.status}`);
  const body = (await res.json()) as { trajectorySummaries?: Record<string, Trajectory> };
  return body.trajectorySummaries ?? {};
}

export interface Trajectory {
  summary?: string;
  status?: string;
  stepCount?: number;
  lastModifiedTime?: string;
  createdTime?: string;
  lastUserInputTime?: string;
  annotations?: { title?: string };
  trajectoryMetadata?: Record<string, unknown>;
  [field: string]: unknown;
}

const RUNNING = new Set(["CASCADE_RUN_STATUS_RUNNING", "CASCADE_RUN_STATUS_BUSY", "CASCADE_RUN_STATUS_CANCELING"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** First value in `value` (depth-first) that satisfies `test`. */
function findDeep(value: unknown, test: (key: string, v: unknown) => boolean, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return undefined;
  for (const [key, v] of Object.entries(value)) {
    if (test(key, v)) return v;
    const found = findDeep(v, test, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** Project and folder: the sidecar (scheduled task) id, else the workspace folder's name. */
export function placeOf(t: Trajectory): { project: string | null; cwd: string } {
  const sidecar = findDeep(t.trajectoryMetadata, (k, v) => k === "sidecarId" && typeof v === "string") as string | undefined;
  const uri = findDeep(t.trajectoryMetadata, (_, v) => typeof v === "string" && v.startsWith("file:///")) as string | undefined;
  let cwd = "";
  if (uri) {
    try {
      cwd = fileURLToPath(uri);
    } catch {}
  }
  return { project: sidecar ?? (cwd ? basename(cwd) : null), cwd };
}

/** The state a conversation shows. */
export function stateOf(t: Trajectory): SessionState {
  const waiting = findDeep(t, (k, v) => /waitingfor(input|user|approval)/i.test(k) && v === true);
  if (waiting) return "needs_permission";
  if (t.status && RUNNING.has(t.status)) return "working";
  // Idle: "done" if the agent did something after the last prompt, else nothing has happened yet.
  return time(t.lastModifiedTime) > time(t.lastUserInputTime) && (t.stepCount ?? 0) > 1 ? "done" : "idle";
}

/** One conversation as a session record, keeping what the previous record already had. */
export function toRecord(id: string, t: Trajectory, prev: SessionRecord | undefined, now: number): SessionRecord {
  const state = stateOf(t);
  const { project, cwd } = placeOf(t);
  const changed = !prev || prev.state !== state || !prev.live;
  const since = state === "done" || state === "idle" ? time(t.lastModifiedTime) || now : now;
  return {
    id,
    name: t.annotations?.title || t.summary || null,
    cwd: cwd || prev?.cwd || "",
    state,
    activity: state === "working" ? "Working…" : state === "needs_permission" ? "Waiting for your approval" : null,
    live: true,
    pid: null,
    stateSince: changed ? since : prev!.stateSince,
    lastEventAt: now,
    source: "antigravity",
    project,
  };
}

/** Polls every running Antigravity into the hub. Returns a stop function. */
export function startAntigravityPoller(
  hub: SessionHub,
  { intervalMs = 2000, hubs = () => liveHubs(), fetch: get = fetchTrajectories, now = Date.now } = {},
) {
  let stopped = false;
  let lastError = "";
  (async () => {
    while (!stopped) {
      try {
        const records: SessionRecord[] = [];
        const daemons = await hubs();
        let answered = 0;
        for (const daemon of daemons) {
          let trajectories: Record<string, Trajectory>;
          try {
            trajectories = await get(daemon); // a stale hub file (reused pid) fails alone
          } catch (err) {
            if (daemons.length === 1) throw err;
            continue;
          }
          answered++;
          for (const [id, t] of Object.entries(trajectories)) {
            if (UUID.test(id)) records.push(toRecord(id, t, hub.record(id), now()));
          }
        }
        // Every hub failing is not "Antigravity closed": end nothing, the next poll decides.
        if (daemons.length === 0 || answered > 0) hub.syncAntigravity(records);
        lastError = "";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastError) console.error(`antigravity poll failed: ${message}`);
        lastError = message; // a failed poll ends nothing: the next one decides
      }
      await Bun.sleep(intervalMs);
    }
  })();
  return () => {
    stopped = true;
  };
}
