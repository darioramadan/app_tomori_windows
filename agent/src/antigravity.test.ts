import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placeOf, startAntigravityPoller, stateOf, toRecord, type Trajectory } from "./antigravity.ts";
import { projectsFrom } from "./desktop-sessions.ts";
import { hasPanelHooks, hookCommand, isPanelHook, mergeHooks } from "./hooks-config.ts";
import { isAlive } from "./open-session.ts";
import { parseSettings, writeHooks } from "./settings.ts";
import { SessionHub } from "./hub.ts";
import { Store } from "./store.ts";

const AG = "7684578c-edb1-4227-9caf-756f5e0947ff";
const CL = "0603472f-b7c5-4dae-b7a1-142468264b30";
const base: Trajectory = {
  summary: "Limpieza De Gmail",
  stepCount: 97,
  status: "CASCADE_RUN_STATUS_IDLE",
  createdTime: "2026-11-14T13:34:02Z",
  lastUserInputTime: "2026-11-14T13:34:02Z",
  lastModifiedTime: "2026-11-14T13:42:00Z",
};

test("run status maps to session state", () => {
  expect(stateOf({ ...base, status: "CASCADE_RUN_STATUS_RUNNING" })).toBe("working");
  expect(stateOf({ ...base, status: "CASCADE_RUN_STATUS_BUSY" })).toBe("working");
  expect(stateOf(base)).toBe("done"); // idle after doing work
  expect(stateOf({ ...base, stepCount: 1, lastModifiedTime: base.lastUserInputTime })).toBe("idle");
  expect(stateOf({ ...base, status: "CASCADE_RUN_STATUS_RUNNING", nested: { waitingForInput: true } })).toBe("needs_permission");
});

test("the project is the sidecar id, else the workspace folder", () => {
  expect(placeOf({ trajectoryMetadata: { sourceMetadata: { sidecar: { sidecarId: "daily-gmail-cleanup" } } } }).project).toBe("daily-gmail-cleanup");
  const ws = placeOf({ trajectoryMetadata: { workspaces: [{ workspaceFolderAbsoluteUri: "file:///c:/Users/dev/Desktop/my-site" }] } });
  expect(ws.project).toBe("my-site");
  expect(ws.cwd.toLowerCase()).toBe(String.raw`c:\users\dev\desktop\my-site`);
  expect(placeOf({}).project).toBeNull();
});

test("an unchanged state keeps its start time", () => {
  const first = toRecord(AG, { ...base, status: "CASCADE_RUN_STATUS_RUNNING" }, undefined, 1000);
  expect(first).toMatchObject({ source: "antigravity", state: "working", stateSince: 1000, name: "Limpieza De Gmail", live: true });
  expect(toRecord(AG, { ...base, status: "CASCADE_RUN_STATUS_RUNNING" }, first, 5000).stateSince).toBe(1000);
});

test("Claude's poll doesn't end Antigravity sessions, and Antigravity's sync doesn't end Claude's", () => {
  const hub = new SessionHub(new Store(), () => 100_000);
  hub.handleHook({ hook_event_name: "UserPromptSubmit", session_id: CL, cwd: "/x" });
  hub.syncSource("antigravity", [toRecord(AG, { ...base, status: "CASCADE_RUN_STATUS_RUNNING" }, undefined, 100_000)]);
  hub.handleAgents([{ sessionId: CL, cwd: "/x", status: "busy", startedAt: 0 }]);
  expect(hub.get(AG)).toMatchObject({ live: true, source: "antigravity", state: "working" });
  hub.syncSource("antigravity", []); // Antigravity closed
  expect(hub.get(AG)?.state).toBe("ended");
  expect(hub.get(CL)).toMatchObject({ live: true, source: "claude" });
});

test("Claude sessions get their project from the desktop app's groups", () => {
  const projects = projectsFrom({
    preferences: {
      epitaxyPrefs: {
        "dframe-group-scopes": {
          "acct/org": {
            groups: [{ id: "cg-1", name: "Work" }, { id: "cg-2", name: "Home" }],
            assignments: { "code:local_a": "cg-1", "code:local_b": "cg-2", "code:local_c": "cg-missing", "chat:x": "cg-1" },
          },
        },
      },
    },
  });
  expect([...projects]).toEqual([["local_a", "Work"], ["local_b", "Home"]]);
  expect(projectsFrom(null).size).toBe(0);

  const hub = new SessionHub(new Store());
  hub.handleHook({ hook_event_name: "SessionStart", session_id: CL, cwd: "/x" });
  const heard: (string | null)[] = [];
  hub.subscribe((c) => c.type === "session" && heard.push(c.session.project));
  hub.setClaudeProjects(new Map([[CL, "Work"]]));
  expect(hub.get(CL)?.project).toBe("Work");
  expect(heard).toEqual(["Work"]);
});

test("hooks run tomari.exe hook and are recognized for removal", () => {
  const command = hookCommand(String.raw`C:\Users\me\AppData\Local\tomari\bin`);
  expect(command).toBe('"C:/Users/me/AppData/Local/tomari/bin/tomari.exe" hook');
  expect(isPanelHook({ type: "command", command })).toBe(true);
  expect(isPanelHook({ type: "command", command: "echo hook" })).toBe(false);
  const installed = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } }, { install: true });
  expect(installed.hooks!.Stop).toHaveLength(2);
  expect(mergeHooks(installed, { install: false })).toEqual({ hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] } });
});

test("a broken Antigravity hub doesn't stop the others", async () => {
  const hub = new SessionHub(new Store(), () => 100_000);
  const good = { pid: 1, httpPort: 1, csrfToken: "a" };
  const bad = { pid: 2, httpPort: 2, csrfToken: "b" };
  const stop = startAntigravityPoller(hub, {
    intervalMs: 5,
    hubs: async () => [bad, good],
    fetch: async (d) => {
      if (d === bad) throw new Error("ECONNREFUSED");
      return { [AG]: { ...base, status: "CASCADE_RUN_STATUS_RUNNING" } };
    },
  });
  await Bun.sleep(30);
  stop();
  expect(hub.get(AG)?.state).toBe("working");
});

test("SessionEnd isn't undone by a poll that still lists the session", () => {
  const hub = new SessionHub(new Store(), () => 100_000);
  hub.handleHook({ hook_event_name: "UserPromptSubmit", session_id: CL, cwd: "/x" });
  hub.handleHook({ hook_event_name: "SessionEnd", session_id: CL, cwd: "/x" });
  hub.handleAgents([{ sessionId: CL, cwd: "/x", status: "idle", startedAt: 0 }]);
  expect(hub.get(CL)?.live).toBe(false);
});

test("an elevated process (EPERM) counts as alive", () => {
  if (process.platform === "win32") expect(isAlive(4)).toBe(true); // pid 4 is System
  expect(isAlive(2 ** 22 + 7)).toBe(false);
});

test("settings: BOM tolerated, write is atomic, only the last 3 backups kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tomari-settings-"));
  const path = join(dir, "settings.json");
  writeFileSync(path, "﻿" + JSON.stringify({ model: "x" }));
  for (let i = 0; i < 5; i++) writeFileSync(join(dir, `settings.json.bak-tomari-${i}`), "{}");
  expect(await writeHooks({ install: true, path })).toBe(true);
  const after = JSON.parse(readFileSync(path, "utf8"));
  expect(after.model).toBe("x");
  expect(hasPanelHooks(after)).toBe(true);
  expect(readdirSync(dir).filter((n) => n.includes(".bak-tomari-")).length).toBe(3);
  expect(readdirSync(dir).some((n) => n.endsWith(".tomari-tmp"))).toBe(false);
  expect(() => parseSettings("{oops", path)).toThrow("not valid JSON");
});
