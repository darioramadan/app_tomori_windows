/**
 * Opens a session (Windows).
 * - Antigravity: launches Antigravity, which brings its open window to the front.
 * - Known to the Claude desktop app (running or stopped while idle): `claude://code/continue?session=local_…`
 *   (undocumented); the app restarts the session if needed.
 * - Running outside the desktop app (a terminal): refused, since resuming would start a second process.
 * - Otherwise: `claude --desktop --resume <id>` (documented, CLI ≥ 2.1.285).
 */
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ANTIGRAVITY_EXE, claudeBin } from "./config.ts";
import { desktopSessionsDir, findDesktopSession, hasDesktopApp } from "./desktop-sessions.ts";
import type { SessionKind, SessionSource } from "../../shared/protocol.ts";
import { isSessionId } from "./protocol-guard.ts";

const LOCAL_ID = /^local_[A-Za-z0-9-]{1,64}$/;
const LIVE_DIR = join(homedir(), ".claude", "sessions");

/** How `claude agents`, `claude attach` and `claude stop` name a background session: the first 8 characters of its id. */
export const backgroundId = (sessionId: string) => sessionId.slice(0, 8);

/** What `openSession` knows about the session beyond its id. */
export interface OpenOptions {
  /** What `claude agents` says the session is, if known. */
  kind?: SessionKind;
  /** Which app runs it. */
  source?: SessionSource;
}

export type OpenResult = { ok: true; command: string[] } | { ok: false; error: string };

interface LiveSession {
  pid: number;
  sessionId: string;
  cwd?: string;
  entrypoint?: string;
}

export function isAlive(pid: number) {
  try {
    process.kill(pid, 0); // signal 0 only checks that the process exists
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, but runs elevated
  }
}

/** Every ~/.claude/sessions/<pid>.json the CLI left behind, running or not. */
async function readSessionFiles(dir: string): Promise<LiveSession[]> {
  const infos: LiveSession[] = [];
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith(".json")) continue;
    const info: LiveSession | null = await Bun.file(`${dir}/${name}`).json().catch(() => null);
    if (info && typeof info.pid === "number" && typeof info.sessionId === "string") infos.push(info);
  }
  return infos;
}

/** Session id → pid of the CLI process, as the CLI recorded it; the process may be gone. */
export async function sessionPids(dir = LIVE_DIR): Promise<Map<string, number>> {
  const pids = new Map<string, number>();
  // A resumed session leaves its old file behind: a running pid beats a dead one.
  for (const info of await readSessionFiles(dir)) {
    const known = pids.get(info.sessionId);
    if (known === undefined || !isAlive(known)) pids.set(info.sessionId, info.pid);
  }
  return pids;
}

/** A running Claude Code process for this session, from the CLI's internal ~/.claude/sessions/<pid>.json. */
async function findLive(id: string, dir: string): Promise<LiveSession | undefined> {
  return (await readSessionFiles(dir)).find((info) => info.sessionId === id && isAlive(info.pid));
}

/** Picks the command that would open the session, without running it. */
export async function planOpen(
  sessionId: string,
  {
    source,
    liveDir = LIVE_DIR,
    desktopDir = desktopSessionsDir(),
    antigravityExe = ANTIGRAVITY_EXE,
  }: OpenOptions & { liveDir?: string; desktopDir?: string; antigravityExe?: string } = {},
): Promise<OpenResult> {
  if (!isSessionId(sessionId)) return { ok: false, error: "invalid session id" };
  if (source === "antigravity") return { ok: true, command: [antigravityExe] };

  const desktop = await findDesktopSession(sessionId, desktopDir);
  if (desktop && LOCAL_ID.test(desktop.localId)) {
    // `start` hands the URL to its registered handler (the MSIX app); "" is start's window title.
    return { ok: true, command: ["cmd", "/c", "start", "", `claude://code/continue?session=${desktop.localId}`] };
  }
  const live = await findLive(sessionId, liveDir);
  if (live) return { ok: false, error: `running outside the desktop app (${live.entrypoint}, pid ${live.pid}): open it in its terminal` };
  if (hasDesktopApp(desktopDir)) return { ok: true, command: [claudeBin(), "--desktop", "--resume", sessionId] };
  return { ok: false, error: "the Claude desktop app is not installed" };
}

export async function openSession(sessionId: string, options: OpenOptions = {}): Promise<OpenResult> {
  const plan = await planOpen(sessionId, options);
  if (!plan.ok) return plan;
  // Antigravity.exe may be the app itself starting: never wait on it (run() would kill it at the timeout).
  return options.source === "antigravity" ? launch(plan.command) : run(plan.command);
}

/** The desktop app's own "new session" link with the folder preselected (`claude --desktop` refuses to run without a console). */
export const planNew = (cwd: string) => ["cmd", "/c", "start", "", `claude://code/new?folder=${encodeURIComponent(cwd)}`];

/** Opens a new conversation in the desktop app, in `cwd`. */
export const newSession = (cwd: string) => run(planNew(cwd));

/** Starts a program and lets it outlive us. */
export function launch(command: string[]): OpenResult {
  try {
    spawn(command[0]!, command.slice(1), { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return { ok: true, command };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A hung `claude stop` must not hold its caller for minutes. */
const COMMAND_TIMEOUT_MS = 15_000;

export async function run(command: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<OpenResult> {
  const proc = Bun.spawn(command, { stdout: "ignore", stderr: "pipe", windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (timedOut) return { ok: false, error: "timed out" };
    if (code !== 0) {
      const detail = stderr.trim().slice(0, 200);
      return { ok: false, error: `${command[0]} exited with ${code}${detail ? `: ${detail}` : ""}` };
    }
    return { ok: true, command };
  } finally {
    clearTimeout(timer);
  }
}
