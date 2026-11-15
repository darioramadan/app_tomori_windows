// Fake agent for smoke runs: bun scripts/fake-agent.ts. Reuses the real token if %LOCALAPPDATA%\tomari\config.json exists.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LibraryEntry, PanelSession } from "../../shared/protocol.ts";

const dir = join(process.env.LOCALAPPDATA ?? ".", "tomari");
const cfg = join(dir, "config.json");
let token = "fake-token";
if (existsSync(cfg)) token = JSON.parse(readFileSync(cfg, "utf8")).token ?? token;
else { mkdirSync(dir, { recursive: true }); writeFileSync(cfg, JSON.stringify({ token })); console.log("wrote temp config", cfg); }

const now = Date.now();
const mk = (id: string, name: string, state: PanelSession["state"], project: string | null, source: PanelSession["source"] = "claude", extra: Partial<PanelSession> = {}): PanelSession => ({
  id, name, cwd: "C:/x", state, activity: null, live: true, stateSince: now - 120_000, pinned: false, position: null,
  icon: { character: "default", color: "#d97757" }, source, project, ...extra,
});
const sessions = [
  mk("1", "Refactor login", "working", "Work", "claude", { activity: "Bash: npm test" }),
  mk("2", "Fix reports", "needs_permission", "Work"),
  mk("3", "Landing copy", "done", "my-site", "antigravity"),
  mk("4", "Notas", "idle", null, "claude", { pinned: true, position: 1, icon: { character: "default", color: "#4f7cff" } }),
];
const library: LibraryEntry[] = sessions.map((s) => ({ id: s.id, name: s.name, cwd: s.cwd, lastActivityAt: now - 3_600_000, pinned: s.pinned, source: s.source, project: s.project }));

Bun.serve({
  port: 7778,
  hostname: "127.0.0.1",
  fetch(req, server) {
    const u = new URL(req.url);
    if (u.pathname !== "/ws" || u.searchParams.get("token") !== token) return new Response("no", { status: 401 });
    return server.upgrade(req) ? undefined : new Response("upgrade", { status: 400 });
  },
  websocket: {
    open(ws) { ws.send(JSON.stringify({ type: "snapshot", sessions, focusedId: "1" })); },
    message(ws, raw) {
      console.log("<-", String(raw));
      if (JSON.parse(String(raw)).type === "library") ws.send(JSON.stringify({ type: "library", sessions: library }));
    },
  },
});
console.log("fake agent on 7778");
