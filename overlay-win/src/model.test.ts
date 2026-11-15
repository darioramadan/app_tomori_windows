import { describe, expect, test } from "bun:test";
import type { PanelSession } from "../../shared/protocol.ts";
import { scalesFor } from "./layout.ts";
import { ANTIGRAVITY_COLOR, DoneChime, DOZE_MS, effectiveColor, groupByProject, lookState, projectColor, SessionList } from "./model.ts";

const base = (o: Partial<PanelSession>): PanelSession => ({
  id: "a", name: "a", cwd: "", state: "idle", activity: null, live: true, stateSince: 0, pinned: false, position: null,
  icon: { character: "default", color: "#d97757" }, source: "claude", project: null, ...o,
});

describe("grouping", () => {
  test("same project contiguous, null last, order kept", () => {
    const g = groupByProject([{ project: "B", n: 1 }, { project: null, n: 2 }, { project: "A", n: 3 }, { project: "B", n: 4 }]);
    expect(g.map((x) => x.project)).toEqual(["B", "A", null]);
    expect(g[0]!.items.map((x) => x.n)).toEqual([1, 4]);
  });
});

describe("project color", () => {
  test("stable and case-insensitive", () => {
    expect(projectColor("Work")).toBe(projectColor("work"));
    expect(projectColor("my-site")).toMatch(/^#[0-9a-f]{6}$/);
  });
  test("pinned icon wins, unpinned default takes project color", () => {
    expect(effectiveColor(base({ project: "Work" }))).toBe(projectColor("Work"));
    expect(effectiveColor(base({ project: "Work", pinned: true }))).toBe("#d97757");
    expect(effectiveColor(base({ project: "Work", icon: { character: "default", color: "#ff5fa2" } }))).toBe("#ff5fa2");
    expect(effectiveColor(base({ project: null }))).toBe("#d97757");
  });
});

describe("visibility", () => {
  const list = (...s: PanelSession[]) => { const l = new SessionList(); l.apply({ type: "snapshot", sessions: s, focusedId: null }); return l; };
  const now = 10 * DOZE_MS;
  test("pinned always, unpinned only when active or recently done", () => {
    const l = list(
      base({ id: "p", pinned: true, position: 1, state: "idle" }),
      base({ id: "w", name: "w", state: "working" }),
      base({ id: "d1", name: "d1", state: "done", stateSince: now - 1000 }),
      base({ id: "d2", name: "d2", state: "done", stateSince: now - DOZE_MS - 1 }),
      base({ id: "i", name: "i", state: "idle" }),
      base({ id: "x", name: "x", state: "working", live: false }),
    );
    expect(l.shown(now).map((s) => s.id)).toEqual(["p", "d1", "w"]);
  });
  test("pinned ordered by position", () => {
    const l = list(base({ id: "b", pinned: true, position: 2 }), base({ id: "a", pinned: true, position: 1 }));
    expect(l.shown(0).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("done chime", () => {
  const done = base({ state: "done" });
  test("only on working -> done, once per burst, not when looking", () => {
    const c = new DoneChime();
    const m = { type: "session", session: done } as const;
    expect(c.shouldChime(m, base({ state: "idle" }), null, false, 0)).toBe(false);
    expect(c.shouldChime(m, base({ state: "working" }), "a", true, 0)).toBe(false);
    expect(c.shouldChime(m, base({ state: "working" }), null, false, 0)).toBe(true);
    expect(c.shouldChime(m, base({ state: "working" }), null, false, 500)).toBe(false);
    expect(c.shouldChime(m, base({ state: "compacting" }), null, false, 2000)).toBe(true);
  });
});

describe("dismiss", () => {
  test("hidden until the session changes state", () => {
    const list = new SessionList();
    const s = base({ state: "done", stateSince: 1000 });
    list.apply({ type: "snapshot", sessions: [s], focusedId: null });
    list.dismiss(s);
    expect(list.shown(2000)).toEqual([]);
    list.apply({ type: "session", session: { ...s, state: "working", stateSince: 3000 } });
    expect(list.shown(3000).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("antigravity and closed looks", () => {
  test("Antigravity is white unless a color was picked; Claude projects keep theirs", () => {
    expect(effectiveColor(base({ source: "antigravity", project: "Agente - Finanzas" }))).toBe(ANTIGRAVITY_COLOR);
    expect(effectiveColor(base({ source: "antigravity", icon: { character: "default", color: "#4f7cff" } }))).toBe("#4f7cff");
    expect(effectiveColor(base({ project: "Work" }))).toBe(projectColor("Work"));
  });
  test("a dead session looks closed, whatever its last state", () => {
    expect(lookState(base({ live: false, state: "done", stateSince: 0 }), 1000)).toBe("closed");
  });
  test("scales keep sprite pixels whole", () => {
    expect(scalesFor(1)).toEqual([2, 1]);
    for (const s of scalesFor(1.5)) expect(Number.isInteger(Math.round(s * 1.5 * 1e9) / 1e9)).toBe(true);
  });
});
