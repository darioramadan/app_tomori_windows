import { claudeBin } from "./config.ts";
import type { SessionHub } from "./hub.ts";
import { isAlive, sessionPids } from "./open-session.ts";
import type { AgentEntry } from "./state.ts";

export interface PollerOptions {
  intervalMs?: number;
  /** Replaceable so tests don't run the real CLI or read ~/.claude/sessions. */
  agents?: () => Promise<AgentEntry[]>;
  sessionPids?: () => Promise<Map<string, number>>;
  isAlive?: (pid: number) => boolean;
}

/** Feeds `claude agents --json` to the hub every `intervalMs`. Returns a stop function. */
export function startPoller(
  hub: SessionHub,
  {
    intervalMs = 3000,
    agents = claudeAgents,
    sessionPids: pids = () => sessionPids(),
    isAlive: alive = isAlive,
  }: PollerOptions = {},
) {
  let stopped = false;
  let lastError = "";

  (async () => {
    while (!stopped) {
      try {
        hub.handleAgents(await agents());
        lastError = "";
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== lastError) console.error(`poll failed: ${message}`); // log each distinct failure once
        lastError = message;
      }
      await Bun.sleep(intervalMs);
    }
  })();
  // Its own loop: the command may be failing or hung, or a closed tab never said SessionEnd.
  (async () => {
    while (!stopped) {
      try {
        hub.endDead(alive, await pids());
      } catch (err) {
        console.error(`liveness check failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await Bun.sleep(intervalMs);
    }
  })();

  return () => {
    stopped = true;
  };
}

const AGENTS_TIMEOUT_MS = 10_000;

/** `claude agents --json`, hidden (the agent has no console) and killed if it hangs. */
async function claudeAgents(): Promise<AgentEntry[]> {
  const proc = Bun.spawn([claudeBin(), "agents", "--json"], { stdout: "pipe", stderr: "ignore", windowsHide: true });
  const timer = setTimeout(() => proc.kill("SIGKILL"), AGENTS_TIMEOUT_MS);
  try {
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) throw new Error(`claude agents exited with ${code}`);
    return JSON.parse(out) as AgentEntry[];
  } finally {
    clearTimeout(timer);
  }
}
