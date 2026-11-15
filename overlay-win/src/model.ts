// Pure logic: which sessions show, how they group, what they look like. Ports SessionList.swift, Status.swift and DoneChime.swift.
import type { LibraryEntry, PanelSession, ServerMessage } from "../../shared/protocol.ts";
import { palette } from "../../site/src/domain/characters.ts";
import type { SessionState as LookState } from "../../site/src/domain/appearance.ts";

export const DOZE_MS = 5 * 60_000;
export const DEFAULT_COLOR = "#d97757";

export const needsAttention = (s: PanelSession) => s.state === "needs_permission" || s.state === "needs_input";

/** Only a live background session can be stopped from the strip. */
export const canStop = (s: PanelSession) => s.live && s.kind === "background";

export const stopNeedsConfirmation = (s: PanelSession) =>
  s.state === "working" || s.state === "compacting" || s.state === "needs_permission" || s.state === "needs_input";

/** Doing something or waiting on the user, or finished recently: shown even unpinned. */
export function isActive(s: PanelSession, now: number): boolean {
  if (!s.live) return false;
  switch (s.state) {
    case "working":
    case "compacting":
    case "needs_permission":
    case "needs_input":
      return true;
    case "done":
    case "error":
      return now - s.stateSince <= DOZE_MS;
    default:
      return false;
  }
}

/** protocol (snake_case) to the site's look states; done and idle doze off after 5 minutes. */
export function lookState(s: PanelSession, now: number): LookState {
  if (!s.live) return "closed"; // gray, without the green "done" border it may have died with
  const dozed = now - s.stateSince > DOZE_MS;
  switch (s.state) {
    case "working": return "working";
    case "needs_permission": return "needsPermission";
    case "needs_input": return "needsInput";
    case "compacting": return "compacting";
    case "error": return "error";
    case "ended": return "sleeping";
    case "idle": return dozed ? "sleeping" : "idle";
    case "done": return dozed ? "sleeping" : "done";
  }
}

export class SessionList {
  sessions = new Map<string, PanelSession>();
  focusedId: string | null = null;
  /** Closed with the ✕: hidden until the session changes state (new activity brings it back). */
  dismissed = new Map<string, number>();

  dismiss(s: PanelSession): void {
    this.dismissed.set(s.id, s.stateSince);
  }

  apply(m: ServerMessage): void {
    switch (m.type) {
      case "snapshot":
        this.sessions = new Map(m.sessions.map((s) => [s.id, s]));
        this.focusedId = m.focusedId;
        break;
      case "session": this.sessions.set(m.session.id, m.session); break;
      case "removed": this.sessions.delete(m.id); break;
      case "focus": this.focusedId = m.id; break;
    }
  }

  /** Pinned by position, then active unpinned by name (not activity, so creatures don't jump around). */
  shown(now: number): PanelSession[] {
    const all = [...this.sessions.values()].filter((s) => this.dismissed.get(s.id) !== s.stateSince);
    const pinned = all.filter((s) => s.pinned).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || cmp(a.id, b.id));
    const others = all.filter((s) => !s.pinned && isActive(s, now)).sort((a, b) => a.name.localeCompare(b.name) || cmp(a.id, b.id));
    return [...pinned, ...others];
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface Group<T> {
  project: string | null;
  items: T[];
}

/** Same project contiguous, groups in order of first appearance, ungrouped (null) last; order inside a group is kept. */
export function groupByProject<T extends { project: string | null }>(items: T[]): Group<T>[] {
  const groups = new Map<string, Group<T>>();
  const none: Group<T> = { project: null, items: [] };
  for (const item of items) {
    if (item.project == null) { none.items.push(item); continue; }
    let g = groups.get(item.project);
    if (!g) groups.set(item.project, (g = { project: item.project, items: [] }));
    g.items.push(item);
  }
  return [...groups.values(), ...(none.items.length ? [none] : [])];
}

/** Stable FNV-1a hash of the project name into the menu palette. */
export function projectColor(project: string): string {
  let h = 0x811c9dc5;
  for (const ch of project.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return palette[h % palette.length]!.color;
}

/** An unpinned session wearing the default color takes its project's; a chosen (pinned) icon wins. */
export const ANTIGRAVITY_COLOR = "#e8e8e8"; // palette White

/** The color a creature wears: one picked by hand wins; else Antigravity is white and a Claude project gets its own. */
export function effectiveColor(s: PanelSession): string {
  if (s.icon.color.toLowerCase() !== DEFAULT_COLOR) return s.icon.color;
  if (s.source === "antigravity") return ANTIGRAVITY_COLOR;
  if (!s.pinned && s.project) return projectColor(s.project);
  return s.icon.color;
}

export function ago(sinceMs: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (s < 5) return "ahora";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function statusLine(s: PanelSession, now: number): string {
  switch (s.state) {
    case "working": return s.activity ?? "trabajando";
    case "needs_permission": return "necesita permiso";
    case "needs_input": return s.activity ?? "te está esperando";
    case "compacting": return "compactando";
    case "error": return s.activity ? `error · ${s.activity}` : "error";
    case "idle": return `inactiva · ${ago(s.stateSince, now)}`;
    case "done": return `listo · ${ago(s.stateSince, now)}`;
    case "ended": return `cerrada · ${ago(s.stateSince, now)}`;
  }
}

export function summary(sessions: PanelSession[]): string {
  const needy = sessions.filter(needsAttention).length;
  if (needy > 0) return needy === 1 ? "1 te espera" : `${needy} te esperan`;
  if (sessions.length === 0) return "sin sesiones";
  return sessions.length === 1 ? "1 sesión" : `${sessions.length} sesiones`;
}

export const truncate = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + "…" : text);

/** Library entries grouped by project, most recent first inside each group. */
export const groupLibrary = (entries: LibraryEntry[]) => groupByProject(entries);

/** Once per burst, only on a live working/compacting -> done, and not while the user is looking at that session. */
export class DoneChime {
  static readonly BURST_MS = 1000;
  private last: number | null = null;

  shouldChime(m: ServerMessage, previous: PanelSession | undefined, focusedId: string | null, appFrontmost: boolean, now: number): boolean {
    if (m.type !== "session" || m.session.state !== "done") return false;
    const before = previous?.state;
    if (before !== "working" && before !== "compacting") return false;
    if (appFrontmost && m.session.id === focusedId) return false;
    if (this.last != null && now - this.last < DoneChime.BURST_MS) return false;
    this.last = now;
    return true;
  }
}
