import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobKey, grokRunning, readRoster, toRecord } from "./grok.ts";
import { SessionHub } from "./hub.ts";
import { Store } from "./store.ts";

const A = "5e858f07-80f2-452c-9929-494d86f41781";
const B = "1d58a72a-8a6f-457e-bdb9-8792c7c6757c";

function base32(text: string) {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = "";
  for (const byte of new TextEncoder().encode(text)) bits += byte.toString(2).padStart(8, "0");
  return bits.match(/.{1,5}/g)!.map((chunk) => ALPHABET[parseInt(chunk.padEnd(5, "0"), 2)]).join("");
}

function grokDir(rows: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "tomari-grok-"));
  const folder = join(dir, "sand-client-persistence");
  mkdirSync(folder);
  writeFileSync(join(folder, `${base32("sand.client.slice.account.x%7Cuser_1.roster.last-roster")}.blob`), JSON.stringify({ schemaVersion: 1, value: { rows } }));
  writeFileSync(join(folder, `${base32("sand.client.slice.ui-layout")}.blob`), "{}");
  writeFileSync(join(dir, "desktop-status.json"), JSON.stringify({ version: 1, pid: 4242, signedIn: true }));
  return dir;
}

test("blob file names decode to their keys", () => {
  expect(blobKey(`${base32("sand.client.slice.ui-layout")}.blob`)).toBe("sand.client.slice.ui-layout");
  expect(blobKey("not-base32!.blob")).toBeNull();
});

test("the roster lists sidebar agents, not groups or hidden ones", async () => {
  const dir = grokDir([
    { id: A, name: "Finanzas", awaitingUserResponse: null, hasUnread: true, lastActivityAt: 5000 },
    { id: B, name: "Group", isGroup: true },
    { id: "33333333-3333-4333-8333-333333333333", name: "Hidden", isHiddenFromSidebar: true },
    { id: "not-a-uuid", name: "Bad" },
  ]);
  expect((await readRoster(dir)).map((a) => a.name)).toEqual(["Finanzas"]);
  expect(await readRoster(join(dir, "missing"))).toEqual([]);
  expect(await grokRunning(dir, (pid) => pid === 4242)).toBe(true);
  expect(await grokRunning(dir, () => false)).toBe(false);
});

test("agents map to waiting, done or idle sessions, and end when Grok closes", () => {
  expect(toRecord({ id: A, name: "Finanzas", awaitingUserResponse: { kind: "question" } }, undefined, 9000)).toMatchObject({ state: "needs_input", source: "grok", project: "Grok", stateSince: 9000 });
  expect(toRecord({ id: A, hasUnread: true, lastActivityAt: 5000 }, undefined, 9000)).toMatchObject({ state: "done", stateSince: 5000 });
  expect(toRecord({ id: A }, undefined, 9000).state).toBe("idle");

  const hub = new SessionHub(new Store(), () => 9000);
  hub.syncSource("grok", [toRecord({ id: A, name: "Finanzas", hasUnread: true, lastActivityAt: 5000 }, undefined, 9000)]);
  expect(hub.get(A)).toMatchObject({ live: true, source: "grok", state: "done", project: "Grok", name: "Finanzas" });
  hub.handleAgents([]); // Claude's poll leaves Grok alone
  expect(hub.get(A)?.live).toBe(true);
  hub.syncSource("grok", []);
  expect(hub.get(A)?.state).toBe("ended");
});
