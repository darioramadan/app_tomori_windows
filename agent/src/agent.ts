import { PANEL_PORT } from "../../shared/protocol.ts";
import { HOOK_PORT, loadConfig } from "./config.ts";
import { watchDesktopFocus } from "./desktop-focus.ts";
import { FocusArbiter } from "./focus-arbiter.ts";
import { FrontApp } from "./front-app.ts";
import { SessionHub } from "./hub.ts";
import { startPoller } from "./poller.ts";
import { startServers } from "./server.ts";
import { Store } from "./store.ts";
import { firstPrompt } from "./transcript.ts";
import { startAntigravityPoller } from "./antigravity.ts";
import { startGrokPoller } from "./grok.ts";
import { desktopSessionsLister } from "./desktop-sessions.ts";

/** Runs until SIGINT or SIGTERM. */
export async function runAgent() {
  const config = await loadConfig();
  const store = new Store(config.dbPath);
  const hub = new SessionHub(store, Date.now, (id, transcriptPath) => firstPrompt(id, { transcriptPath }));
  const front = new FrontApp();
  const servers = startServers({
    hub,
    front,
    token: config.token,
    hookPort: HOOK_PORT,
    panelPort: PANEL_PORT,
  });
  const stopPoller = startPoller(hub);
  // Both focus sources coexist: the one for the app in front wins, and the other waits (see FocusArbiter).
  const arbiter = new FocusArbiter(front, (id) => hub.setFocused(id));
  const stopFocus = watchDesktopFocus((id) => arbiter.desktop(id));
  const stopAntigravity = startAntigravityPoller(hub);
  const stopGrok = startGrokPoller(hub);
  // Projects (sidebar groups) of the desktop app's sessions; they change rarely.
  const listDesktop = desktopSessionsLister();
  const refreshProjects = () =>
    listDesktop()
      .then((sessions) => hub.setClaudeProjects(new Map(sessions.filter((s) => s.project).map((s) => [s.sessionId, s.project!]))))
      .catch((err) => console.error(`projects refresh failed: ${err instanceof Error ? err.message : String(err)}`));
  refreshProjects();
  const projectsTimer = setInterval(refreshProjects, 15_000);
  const pruneTimer = setInterval(() => hub.prune(), 10 * 60 * 1000);
  // One line per change, so the log shows which focus source applies.
  front.subscribe((app) => console.log(`${new Date().toLocaleTimeString("en-GB", { hour12: false })}  front app → ${app}`));

  hub.subscribe((change) => {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    if (change.type === "removed") return console.log(`${time}  ${change.id.slice(0, 8)}  removed`);
    if (change.type === "focus") return console.log(`${time}  focus → ${change.id ? hub.get(change.id)?.name ?? change.id : "none"}`);
    const s = change.session;
    const flags = `${s.live ? "" : " (not live)"}${s.pinned ? " ★" : ""}`;
    console.log(`${time}  ${s.id.slice(0, 8)}  ${s.state.padEnd(16)} ${s.name}${flags}  ${s.activity ?? ""}`);
  });

  console.log(`tomari agent
  hooks : http://127.0.0.1:${HOOK_PORT}/hook
  panel : ws://127.0.0.1:${PANEL_PORT}/ws
  data  : ${config.dbPath}
`);

  function shutdown() {
    clearInterval(pruneTimer);
    stopPoller();
    stopFocus();
    stopAntigravity();
    stopGrok();
    clearInterval(projectsTimer);
    servers.stop();
    store.close();
    process.exit(0);
  }
  // Without these an error in a timer would end the agent with nothing in the log.
  process.on("uncaughtException", (err) => console.error("uncaught:", err));
  process.on("unhandledRejection", (err) => console.error("unhandled rejection:", err));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
