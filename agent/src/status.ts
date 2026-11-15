import { PANEL_PORT } from "../../shared/protocol.ts";
import { describe, tomariJobs } from "./autostart.ts";
import { BIN_DIR, LOG_DIR } from "./config.ts";
import { hooksInstalled } from "./settings.ts";

export async function status(version: string) {
  const [agent] = tomariJobs(BIN_DIR);
  const health = await fetch(`http://127.0.0.1:${PANEL_PORT}/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json() as Promise<{ sessions: number }>)
    .catch(() => null);
  console.log(`tomari ${version}
  agent   : ${await describe(agent!)}
  hooks   : ${(await hooksInstalled()) ? "installed" : "not installed"}
  health  : ${health ? `answering, ${health.sessions} sessions` : `no answer on :${PANEL_PORT}`}
  logs    : ${LOG_DIR}`);
}
