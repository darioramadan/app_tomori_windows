// WebSocket to the agent: reconnects every 2s, keeps the session list, reports the front app.
import type { ClientMessage, FrontApp, LibraryEntry, ServerMessage } from "../../shared/protocol.ts";
import { PANEL_PORT } from "../../shared/protocol.ts";
import { DoneChime, SessionList } from "./model.ts";

export interface Notice {
  sessionId: string | null; // null: about the add button
  message: string;
}

export class AgentLink {
  list = new SessionList();
  online = false;
  notice: Notice | null = null;
  soundOnDone = false;
  frontApp: FrontApp = "other";
  onChange: () => void = () => {};
  onChime: () => void = () => {};

  private ws: WebSocket | null = null;
  private lastSent: ClientMessage | null = null;
  private libraryReply: ((e: LibraryEntry[]) => void) | null = null;
  private noticeTimer: number | undefined;
  private chime = new DoneChime();

  /** `token` is asked on every connect: setup may have rotated it since the last one. */
  constructor(private token: () => Promise<string | null>) {}

  start(): void {
    void this.connect();
  }

  setFrontApp(app: FrontApp): void {
    this.frontApp = app;
    this.raw({ type: "frontApp", app });
  }

  send(m: ClientMessage): void {
    if (!this.online) return this.show({ sessionId: sessionIdOf(m), message: "sin conexión con el agente" });
    this.lastSent = m;
    this.raw(m);
  }

  requestLibrary(reply: (e: LibraryEntry[]) => void): void {
    this.libraryReply = reply;
    this.send({ type: "library" });
  }

  private raw(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private async connect(): Promise<void> {
    const token = await this.token().catch(() => null);
    if (!token) return void setTimeout(() => void this.connect(), 2000);
    const ws = new WebSocket(`ws://127.0.0.1:${PANEL_PORT}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.online = true;
      this.raw({ type: "frontApp", app: this.frontApp });
      this.onChange();
    };
    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try { m = JSON.parse(String(ev.data)) as ServerMessage; } catch { return; }
      this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.online = false;
      this.onChange();
      setTimeout(() => void this.connect(), 2000);
    };
    ws.onerror = () => ws.close();
  }

  private handle(m: ServerMessage): void {
    if (m.type === "error") {
      if (this.lastSent) this.show({ sessionId: sessionIdOf(this.lastSent), message: m.message });
    } else if (m.type === "library") {
      this.libraryReply?.(m.sessions);
      this.libraryReply = null;
    } else {
      if (this.soundOnDone && m.type === "session") {
        const front = this.frontApp === "desktop" || this.frontApp === "antigravity";
        if (this.chime.shouldChime(m, this.list.sessions.get(m.session.id), this.list.focusedId, front, Date.now())) this.onChime();
      }
      this.list.apply(m);
    }
    this.onChange();
  }

  private show(n: Notice): void {
    this.notice = n;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.notice = null; this.onChange(); }, 4000);
    this.onChange();
  }
}

const sessionIdOf = (m: ClientMessage): string | null => ("id" in m ? m.id : null);
