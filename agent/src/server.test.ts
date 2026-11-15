import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { ServerMessage } from "../../shared/protocol.ts";
import type { DesktopSession } from "./desktop-sessions.ts";
import { FrontApp } from "./front-app.ts";
import { SessionHub } from "./hub.ts";
import { planOpen, type OpenResult } from "./open-session.ts";
import { startServers } from "./server.ts";
import { Store } from "./store.ts";

const ID = "0603472f-b7c5-4dae-b7a1-142468264b30";
const TOKEN = "test-token";

const IDLE = "22222222-2222-4222-8222-222222222222";
const DESKTOP: DesktopSession[] = [
  { localId: "local_idle", sessionId: IDLE, title: "Idle work", cwd: "/Users/dev/idle", lastActivityAt: 5000, archived: false, project: "Work" },
  { localId: "local_old", sessionId: "33333333-3333-4333-8333-333333333333", title: "Old", cwd: "/x", lastActivityAt: 1, archived: true, project: null },
];

let servers: ReturnType<typeof startServers>;
let hub: SessionHub;
let front: FrontApp;
let opened: [id: string, kind: string | undefined][];
let stopped: string[];
let created: string[];
let stop: (id: string) => Promise<OpenResult>;
let desktopSessions: () => Promise<DesktopSession[]>;

beforeEach(() => {
  opened = [];
  stopped = [];
  created = [];
  stop = async (id) => {
    stopped.push(id);
    return { ok: true, command: ["fake-stop", id] };
  };
  hub = new SessionHub(new Store());
  front = new FrontApp();
  desktopSessions = async () => DESKTOP;
  servers = startServers({
    hub,
    front,
    token: TOKEN,
    hookPort: 0, // 0 = any free port
    panelPort: 0,
    open: async (id, { kind } = {}) => {
      opened.push([id, kind]);
      return { ok: true, command: ["fake-open", id] };
    },
    desktopSessions: () => desktopSessions(),
    stop: (id) => stop(id),
    create: async (cwd) => {
      created.push(cwd);
      return { ok: true, command: ["fake-new", cwd] };
    },
  });
});
afterEach(() => servers.stop());

const hookUrl = () => `http://127.0.0.1:${servers.hookServer.port}/hook`;
const panelHttp = () => `http://127.0.0.1:${servers.panelServer.port}`;

function postHook(event: Record<string, unknown>, url = hookUrl()) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event) });
}

/** Opens a panel connection; next() resolves with the following server message. */
async function connect(token = TOKEN) {
  const ws = new WebSocket(`ws://127.0.0.1:${servers.panelServer.port}/ws?token=${token}`);
  const inbox: ServerMessage[] = [];
  const waiting: ((m: ServerMessage) => void)[] = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    const resolve = waiting.shift();
    if (resolve) resolve(msg);
    else inbox.push(msg);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const next = () =>
    inbox.length > 0 ? Promise.resolve(inbox.shift()!) : new Promise<ServerMessage>((resolve) => waiting.push(resolve));
  return { ws, next };
}

async function waitFor(condition: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await Bun.sleep(5);
  }
}

test("a wrong token is rejected", async () => {
  expect((await fetch(`${panelHttp()}/ws?token=nope`)).status).toBe(401);
  expect((await fetch(`${panelHttp()}/ws`)).status).toBe(401);
});

test("the network-facing port does not accept hook events", async () => {
  const res = await postHook({ hook_event_name: "Stop", session_id: ID, cwd: "/tmp" }, `${panelHttp()}/hook`);
  expect(res.status).toBe(404);
});

test("the panel gets a snapshot, then live updates from hooks", async () => {
  const { ws, next } = await connect();
  expect(await next()).toEqual({ type: "snapshot", sessions: [], focusedId: null });

  const res = await postHook({ hook_event_name: "UserPromptSubmit", session_id: ID, cwd: "/tmp/demo" });
  expect(res.status).toBe(204);
  expect(await next()).toMatchObject({ type: "session", session: { id: ID, name: "demo", state: "working", live: true } });
  ws.close();
});

test("pin, icon and open commands; anything else is refused", async () => {
  await postHook({ hook_event_name: "Stop", session_id: ID, cwd: "/tmp/demo" });
  const { ws, next } = await connect();
  await next(); // snapshot

  ws.send(JSON.stringify({ type: "pin", id: ID, pinned: true }));
  expect(await next()).toMatchObject({ type: "session", session: { id: ID, pinned: true, position: 0 } });

  ws.send(JSON.stringify({ type: "pin", id: ID, pinned: false }));
  expect(await next()).toMatchObject({ type: "session", session: { pinned: false } });

  ws.send(JSON.stringify({ type: "icon", id: ID, icon: { character: "crab", color: "#ff6a1a" } }));
  expect(await next()).toMatchObject({ type: "session", session: { pinned: true, icon: { character: "crab" } } });

  ws.send(JSON.stringify({ type: "open", id: ID }));
  await waitFor(() => opened.length === 1);
  expect(opened).toEqual([[ID, undefined]]);
  expect(await next()).toEqual({ type: "focus", id: ID });

  ws.send(JSON.stringify({ type: "open", id: "11111111-1111-1111-1111-111111111111" }));
  expect(await next()).toEqual({ type: "error", message: "unknown session" });

  ws.send("rm -rf /");
  expect(await next()).toEqual({ type: "error", message: "invalid message" });
  ws.close();
});

test("the library lists desktop sessions, and pinning one that isn't running adopts it", async () => {
  const { ws, next } = await connect();
  await next(); // snapshot

  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toEqual({
    type: "library",
    sessions: [{ id: IDLE, name: "Idle work", cwd: "/Users/dev/idle", lastActivityAt: 5000, pinned: false, source: "claude", project: "Work" }],
  });

  ws.send(JSON.stringify({ type: "pin", id: IDLE, pinned: true }));
  expect(await next()).toMatchObject({ type: "session", session: { id: IDLE, name: "Idle work", live: false, state: "ended" } });
  expect(await next()).toMatchObject({ type: "session", session: { id: IDLE, pinned: true } });

  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toMatchObject({ type: "library", sessions: [{ id: IDLE, pinned: true }] });
  ws.close();
});

test("the library also lists live terminal sessions, newest first; the desktop entry wins a duplicate", async () => {
  const NEWER = { ...DESKTOP[0]!, localId: "local_newer", sessionId: "44444444-4444-4444-8444-444444444444", title: "Newer", lastActivityAt: Date.now() + 60_000 };
  desktopSessions = async () => [NEWER, ...DESKTOP];
  const GONE = "55555555-5555-4555-8555-555555555555";
  await postHook({ hook_event_name: "UserPromptSubmit", session_id: ID, cwd: "/tmp/demo" });
  await postHook({ hook_event_name: "UserPromptSubmit", session_id: IDLE, cwd: "/tmp/elsewhere" }); // also in the desktop list
  await postHook({ hook_event_name: "UserPromptSubmit", session_id: GONE, cwd: "/tmp/gone" });
  await postHook({ hook_event_name: "SessionEnd", session_id: GONE, cwd: "/tmp/gone", reason: "other" });
  const { ws, next } = await connect();
  await next(); // snapshot

  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toEqual({
    type: "library",
    sessions: [
      { id: NEWER.sessionId, name: "Newer", cwd: "/Users/dev/idle", lastActivityAt: NEWER.lastActivityAt, pinned: false, source: "claude", project: "Work" },
      { id: ID, name: "demo", cwd: "/tmp/demo", lastActivityAt: expect.any(Number), pinned: false, source: "claude", project: null },
      { id: IDLE, name: "Idle work", cwd: "/Users/dev/idle", lastActivityAt: 5000, pinned: false, source: "claude", project: "Work" },
    ],
  });
  ws.close();
});

test("a terminal session from the library can be pinned", async () => {
  await postHook({ hook_event_name: "Stop", session_id: ID, cwd: "/tmp/demo" });
  const { ws, next } = await connect();
  await next(); // snapshot

  ws.send(JSON.stringify({ type: "pin", id: ID, pinned: true }));
  expect(await next()).toMatchObject({ type: "session", session: { id: ID, pinned: true } });
  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toMatchObject({ type: "library", sessions: [{ id: ID, pinned: true }, { id: IDLE }] });
  ws.close();
});

test("a message that fails is answered with an error, and the server keeps serving", async () => {
  const { ws, next } = await connect();
  await next(); // snapshot

  desktopSessions = async () => {
    throw new Error("disk on fire");
  };
  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toEqual({ type: "error", message: "internal error" });

  desktopSessions = async () => DESKTOP;
  ws.send(JSON.stringify({ type: "library" }));
  expect(await next()).toMatchObject({ type: "library", sessions: [{ id: IDLE }] });
  ws.close();
});

const BG = "4c3f6979-6d4f-4add-8de8-b71ea72d0f6e";

test("opening a background session tells the opener its kind", async () => {
  hub.handleAgents([{ sessionId: BG, cwd: "/tmp/bg", kind: "background", status: "idle", startedAt: 0 }]);
  const { ws, next } = await connect();
  await next(); // snapshot
  ws.send(JSON.stringify({ type: "open", id: BG }));
  await waitFor(() => opened.length === 1);
  expect(opened).toEqual([[BG, "background"]]);
  ws.close();
});

test("stop ends a live background session right away", async () => {
  hub.handleAgents([{ sessionId: BG, cwd: "/tmp/bg", kind: "background", status: "busy", startedAt: 0 }]);
  const { ws, next } = await connect();
  await next(); // snapshot
  ws.send(JSON.stringify({ type: "stop", id: BG }));
  expect(await next()).toMatchObject({ type: "session", session: { id: BG, state: "ended", live: false } });
  expect(stopped).toEqual([BG]);
  ws.close();
});

test("stop refuses interactive, closed and unknown sessions without running anything", async () => {
  await postHook({ hook_event_name: "Stop", session_id: ID, cwd: "/tmp/demo" }); // kind unknown
  hub.handleAgents([{ sessionId: BG, cwd: "/tmp/bg", kind: "background", status: "idle", startedAt: 0 }]);
  hub.endSession(BG);
  const { ws, next } = await connect();
  await next(); // snapshot
  for (const id of [ID, BG]) {
    ws.send(JSON.stringify({ type: "stop", id }));
    expect(await next()).toEqual({ type: "error", message: "not a running background session" });
  }
  ws.send(JSON.stringify({ type: "stop", id: IDLE })); // a desktop session: must not even be adopted
  expect(await next()).toEqual({ type: "error", message: "unknown session" });
  expect(stopped).toEqual([]);
  ws.close();
});

test("a failed stop reaches the panel and leaves the session alone", async () => {
  hub.handleAgents([{ sessionId: BG, cwd: "/tmp/bg", kind: "background", status: "idle", startedAt: 0 }]);
  stop = async () => ({ ok: false, error: "claude exited with 1" });
  const { ws, next } = await connect();
  await next(); // snapshot
  ws.send(JSON.stringify({ type: "stop", id: BG }));
  expect(await next()).toEqual({ type: "error", message: "claude exited with 1" });
  expect(hub.get(BG)!.live).toBe(true);
  ws.close();
});

test("a second stop while the first is still running is ignored, and the id can be stopped again afterwards", async () => {
  hub.handleAgents([{ sessionId: BG, cwd: "/tmp/bg", kind: "background", status: "busy", startedAt: 0 }]);
  let finish!: (r: OpenResult) => void;
  stop = (id) => {
    stopped.push(id);
    return new Promise((resolve) => (finish = resolve));
  };
  const { ws, next } = await connect();
  await next(); // snapshot
  ws.send(JSON.stringify({ type: "stop", id: BG }));
  await waitFor(() => stopped.length === 1);
  ws.send(JSON.stringify({ type: "stop", id: BG }));
  expect(await next()).toEqual({ type: "error", message: "already stopping" });
  expect(stopped).toEqual([BG]);
  finish({ ok: false, error: "claude exited with 1" });
  expect(await next()).toEqual({ type: "error", message: "claude exited with 1" });
  ws.send(JSON.stringify({ type: "stop", id: BG })); // the guard was released
  await waitFor(() => stopped.length === 2);
  finish({ ok: true, command: ["fake-stop", BG] });
  ws.close();
});

test("a client reports the front app, and it is unknown again once that client leaves", async () => {
  const { ws, next } = await connect();
  await next(); // snapshot
  expect(front.value).toBe("unknown");
  ws.send(JSON.stringify({ type: "frontApp", app: "terminal" }));
  await waitFor(() => front.value === "terminal");
  ws.send(JSON.stringify({ type: "frontApp", app: "other" }));
  await waitFor(() => front.value === "other");
  ws.close();
  await waitFor(() => front.value === "unknown");
});

test("a client that never reported leaves the front app alone when it disconnects", async () => {
  const reporter = await connect();
  await reporter.next();
  reporter.ws.send(JSON.stringify({ type: "frontApp", app: "desktop" }));
  await waitFor(() => front.value === "desktop");
  const viewer = await connect(); // a second client that only watches
  await viewer.next();
  viewer.ws.close();
  await Bun.sleep(50);
  expect(front.value).toBe("desktop");
  reporter.ws.close();
});

test("new starts a conversation in a known session's folder, without adopting it", async () => {
  const dir = mkdtempSync(`${tmpdir()}/tomari-new-`);
  desktopSessions = async () => [{ ...DESKTOP[0]!, cwd: dir }];
  const { ws, next } = await connect();
  await next(); // snapshot
  ws.send(JSON.stringify({ type: "new", id: IDLE }));
  await waitFor(() => created.length === 1);
  expect(created).toEqual([dir]);
  expect(hub.has(IDLE)).toBe(false);
  ws.send(JSON.stringify({ type: "new", id: ID })); // unknown: nothing runs
  expect(await next()).toEqual({ type: "error", message: "unknown session" });
  expect(created).toHaveLength(1);
  ws.close();
  rmSync(dir, { recursive: true });
});
