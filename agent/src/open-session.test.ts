import { afterEach, beforeEach, expect, test } from "bun:test";
import { claudeBin } from "./config.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planNew, planOpen, run, sessionPids, type OpenResult } from "./open-session.ts";

const ID = "0603472f-b7c5-4dae-b7a1-142468264b30";
const CLOSED = "22222222-2222-4222-8222-222222222222"; // not running
const REFUSED: OpenResult = { ok: false, error: `running outside the desktop app (cli, pid ${process.pid}): open it in its terminal` };

let root: string;
let liveDir: string;
let desktopDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "open-session-"));
  liveDir = join(root, "live");
  desktopDir = join(root, "desktop"); // left missing: no desktop app
  mkdirSync(liveDir);
  // process.pid makes the fake session count as running.
  writeFileSync(join(liveDir, "1.json"), JSON.stringify({ pid: process.pid, sessionId: ID, entrypoint: "cli" }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a session the desktop app knows opens through its claude:// link", async () => {
  mkdirSync(join(desktopDir, "account", "org"), { recursive: true });
  writeFileSync(join(desktopDir, "account", "org", "local_abc-123.json"), JSON.stringify({ sessionId: "local_abc-123", cliSessionId: ID }));
  expect(await planOpen(ID, { liveDir, desktopDir })).toEqual({
    ok: true,
    command: ["cmd", "/c", "start", "", "claude://code/continue?session=local_abc-123"],
  });
});

test("a live session outside the desktop app is refused", async () => {
  expect(await planOpen(ID, { liveDir, desktopDir })).toEqual(REFUSED);
});

test("with the desktop app, a closed session resumes there", async () => {
  mkdirSync(desktopDir);
  expect(await planOpen(CLOSED, { liveDir, desktopDir })).toEqual({ ok: true, command: [claudeBin(), "--desktop", "--resume", CLOSED] });
});

test("without the desktop app a closed session can't be opened", async () => {
  expect(await planOpen(CLOSED, { liveDir, desktopDir })).toEqual({ ok: false, error: "the Claude desktop app is not installed" });
});

test("an Antigravity session brings Antigravity to the front", async () => {
  expect(await planOpen(CLOSED, { source: "antigravity", antigravityExe: "C:/ag/Antigravity.exe" })).toEqual({ ok: true, command: ["C:/ag/Antigravity.exe"] });
});

test("an invalid id is refused before anything runs", async () => {
  expect(await planOpen("nope", { source: "antigravity" })).toEqual({ ok: false, error: "invalid session id" });
});

test("a resumed session maps to its running pid, not the dead one left behind", async () => {
  writeFileSync(join(liveDir, "0.json"), JSON.stringify({ pid: 2_000_000_000, sessionId: ID }));
  expect((await sessionPids(liveDir)).get(ID)).toBe(process.pid);
});

test("a command that never finishes is killed and reported as timed out", async () => {
  const started = Date.now();
  expect(await run(["ping", "-n", "30", "127.0.0.1"], 50)).toEqual({ ok: false, error: "timed out" });
  expect(Date.now() - started).toBeLessThan(5000);
  expect(await run(["cmd", "/c", "exit", "0"], 5000)).toEqual({ ok: true, command: ["cmd", "/c", "exit", "0"] });
});

test("a new conversation opens the desktop app's new-session link with the folder encoded", () => {
  expect(planNew(String.raw`C:\Users\dev\my app`)).toEqual(["cmd", "/c", "start", "", "claude://code/new?folder=C%3A%5CUsers%5Cdev%5Cmy%20app"]);
});
