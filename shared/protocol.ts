/**
 * Contract between the agent and the Tomari overlay (overlay-win/src/protocol.ts imports this file),
 * over a WebSocket at ws://127.0.0.1:PANEL_PORT/ws?token=<pairing token>.
 * The agent sends a snapshot on connect, then one message per change. The overlay shows pinned
 * sessions and those working or waiting on the user.
 */

export const PANEL_PORT = 7778;

export const SESSION_STATES = [
  "idle", // started, no prompt yet
  "working",
  "needs_permission",
  "needs_input", // a question, a plan to review, or otherwise waiting on the user
  "compacting",
  "done", // finished its turn: the user's move
  "error",
  "ended", // process gone
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

export interface SessionIcon {
  /** Sprite sheet id. */
  character: string;
  /** "#rrggbb" */
  color: string;
}

export const DEFAULT_ICON: SessionIcon = { character: "default", color: "#d97757" };

/** What `claude agents` says a session is. Clients must treat other values as unknown. */
export type SessionKind = "interactive" | "background" | (string & {});

/** The Claude daemon's own sessions (`--bg`, `claude agents`): no terminal tty to focus. */
export const BACKGROUND_KIND = "background" satisfies SessionKind;

export interface PanelSession {
  id: string;
  name: string;
  cwd: string;
  state: SessionState;
  /** Short detail for the tile, e.g. "Bash: npm test". */
  activity: string | null;
  /** The Claude process is running. */
  live: boolean;
  /** Epoch ms of the last state change. */
  stateSince: number;
  pinned: boolean;
  /** Order among pinned sessions; null when not pinned. */
  position: number | null;
  icon: SessionIcon;
  /**
   * From `claude agents`: "interactive" (a terminal) or "background" (`--bg`, run by the Claude daemon).
   * Absent until the poll has seen the session. Clients must treat other values as unknown.
   */
  kind?: SessionKind;
  /** Which app runs the session. */
  source: SessionSource;
  /** Project (group) the session belongs to in its app, e.g. "Work" or "my-site"; null when ungrouped. */
  project: string | null;
}

export const SESSION_SOURCES = ["claude", "antigravity", "grok"] as const;
export type SessionSource = (typeof SESSION_SOURCES)[number];

/** A desktop-app session the panel can pin, running or not. */
export interface LibraryEntry {
  id: string;
  name: string;
  cwd: string;
  /** Epoch ms of its last activity. */
  lastActivityAt: number;
  pinned: boolean;
  source: SessionSource;
  project: string | null;
}

export type ServerMessage =
  | { type: "snapshot"; sessions: PanelSession[]; focusedId: string | null }
  | { type: "session"; session: PanelSession }
  | { type: "removed"; id: string }
  | { type: "focus"; id: string | null } // the session in front in the desktop app; null when none
  | { type: "library"; sessions: LibraryEntry[] } // reply to a library request, most recent first
  | { type: "error"; message: string };

/** What the overlay says is in front: the Claude desktop app, Antigravity, or anything else. ("terminal" is never sent on Windows.) */
export const FRONT_APPS = ["terminal", "desktop", "antigravity", "other"] as const;
export type FrontApp = (typeof FRONT_APPS)[number];

/** `pin` and `icon` also accept a desktop session that isn't running: the agent starts tracking it. */
export type ClientMessage =
  | { type: "open"; id: string }
  | { type: "pin"; id: string; pinned: boolean }
  | { type: "new"; id: string } // starts a new desktop-app conversation in the same folder as this session
  | { type: "stop"; id: string } // stops a live background session; its conversation is kept
  | { type: "icon"; id: string; icon: SessionIcon } // pins the session if it isn't yet
  | { type: "library" }
  | { type: "frontApp"; app: FrontApp }; // sent on connect and when the app in front changes
