import { invoke, listen } from "./bridge.ts";
import type { FrontApp, LibraryEntry, PanelSession } from "../../shared/protocol.ts";
import type { Look } from "../../site/src/domain/appearance.ts";
import "./style.css";
import { playChime } from "./chime.ts";
import { fitting, headerHeight, LABEL_GAP, type StripMetrics } from "./layout.ts";
import { AgentLink } from "./link.ts";
import { addButtonLook, antigravityBadge, sessionLook, tabLook } from "./look.ts";
import { creatureMenu, libraryMenu } from "./menu.ts";
import { groupByProject, needsAttention, statusLine, summary } from "./model.ts";

interface Prefs { edge: "left" | "right"; sound: boolean; hidden: boolean; collapsed: boolean }
type Cell = { kind: "session"; id: string } | { kind: "add" } | { kind: "tab" };
type Item = { kind: "header"; project: string | null; first: boolean; h: number } | { kind: "session"; s: PanelSession } | { kind: "add" };

const LABEL_W = 350;
const MENU_W = 300;
const FRAME_MS = 250;
const POLL_MS = 1000 / 4;
const AUTO_COLLAPSE_MS = 15_000; // expanded and untouched this long: fold away by itself
let lastTouch = Date.now();

let prefs: Prefs = { edge: "right", sound: false, hidden: false, collapsed: false };
let workHeight = window.screen.availHeight; // replaced by the main process's work area
let hovered: Cell | null = null;
let menuOpen = false;
let metrics: StripMetrics;
let shownSessions: PanelSession[] = [];
let structureKey = "";
let lastWindow = "";
let lastWaiting = -1;

const root = document.getElementById("root")!;
const drawer = div("drawer");
const strip = div("strip");
const tab = div("tab");
const label = div("label");
const veil = div("veil");
veil.style.cssText = "position:absolute;inset:0;display:none";
root.append(drawer, label, veil);
drawer.append(tab, strip);

function div(id: string): HTMLDivElement {
  const d = document.createElement("div");
  d.id = id;
  return d;
}

const link = new AgentLink(() => invoke<string | null>("get_token"));
link.onChime = playChime;
link.onChange = () => render();

/** The session as the agent last described it (rebuilt cells hold an older copy). */
const current = (id: string) => link.list.sessions.get(id);

interface Paintable { tile: HTMLElement; canvas: HTMLCanvasElement }
const paintables = new Map<HTMLElement, Paintable>();

function paintable(host: HTMLElement, scale: number, pixelsW: number, pixelsH: number, inset: number, radius: string): Paintable {
  const tile = document.createElement("div");
  tile.className = "tile";
  const canvas = document.createElement("canvas");
  canvas.className = "sp";
  canvas.width = pixelsW;
  canvas.height = pixelsH;
  canvas.style.cssText = `left:${inset}px;top:${inset}px;width:${pixelsW * scale}px;height:${pixelsH * scale}px`;
  tile.style.borderRadius = radius;
  host.append(tile, canvas);
  return { tile, canvas };
}

function drawPixels(canvas: HTMLCanvasElement, pixels: (string | null)[][]): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pixels.forEach((row, y) => row.forEach((c, x) => { if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); } }));
}

function paint(p: Paintable, look: Look, scale: number): void {
  const { tile } = look;
  p.tile.style.background = tile.fill ?? "transparent";
  p.tile.style.border = tile.border ? `${tile.borderWidth * scale}px solid ${tile.border}` : "0";
  drawPixels(p.canvas, look.pixels);
  p.canvas.style.opacity = String(look.opacity);
}

function currentItems(now: number): Item[] {
  shownSessions = link.list.shown(now);
  const groups = groupByProject(shownSessions);
  const items: Item[] = [];
  groups.forEach((g, i) => {
    const h = headerHeight(g.project, groups.length);
    if (h > 0) items.push({ kind: "header", project: g.project, first: i === 0, h });
    for (const s of g.items) items.push({ kind: "session", s });
  });
  items.push({ kind: "add" });
  return items;
}

function rebuild(items: Item[]): void {
  const headers = items.reduce((n, i) => n + (i.kind === "header" ? i.h : 0), 0);
  metrics = fitting(items.filter((i) => i.kind !== "header").length, headers, workHeight, window.devicePixelRatio);
  const { scale, cellSide } = metrics;
  paintables.clear();
  strip.replaceChildren();
  strip.style.width = `${metrics.stripW}px`;
  strip.style.height = `${metrics.stripH}px`;
  strip.style.borderRadius = prefs.edge === "right" ? "10px 0 0 10px" : "0 10px 10px 0";
  strip.style.borderWidth = prefs.edge === "right" ? "1px 0 1px 1px" : "1px 1px 1px 0";
  for (const it of items) {
    if (it.kind === "header") {
      const h = document.createElement("div");
      h.className = "gh" + (it.first ? " first" : "");
      h.style.height = `${it.h}px`;
      if (it.project) { h.textContent = it.project; h.title = it.project; } // CSS cuts it with an ellipsis to the strip width
      strip.append(h);
      continue;
    }
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.cssText = `width:${cellSide}px;height:${cellSide}px`;
    const p = paintable(cell, scale, 24, 24, 2 * scale, `${3 * scale}px`);
    p.tile.style.cssText += `;inset:${scale}px`;
    paintables.set(cell, p);
    const id = it.kind === "session" ? it.s.id : "";
    cell.dataset.kind = it.kind;
    cell.dataset.id = id;
    if (it.kind === "session") {
      if (it.s.source === "antigravity") cell.append(badgeCanvas(scale));
      cell.append(closeButton(id));
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); openCreatureMenu(id); });
    }
    cell.addEventListener("mouseenter", () => setHover(it.kind === "session" ? { kind: "session", id } : { kind: "add" }));
    cell.addEventListener("mouseleave", () => setHover(null));
    cell.addEventListener("click", () => (it.kind === "session" ? link.send({ type: "open", id }) : openLibrary()));
    strip.append(cell);
  }
  tab.replaceChildren();
  tab.style.cssText = `width:${metrics.tabW}px;height:${metrics.tabH}px`;
  tab.style.borderRadius = prefs.edge === "right" ? `${3 * scale}px 0 0 ${3 * scale}px` : `0 ${3 * scale}px ${3 * scale}px 0`;
  tab.style.borderWidth = prefs.edge === "right" ? "1px 0 1px 1px" : "1px 1px 1px 0";
  const tp = paintable(tab, scale, 8, 21, 0, "inherit");
  tp.tile.style.inset = "0";
  paintables.set(tab, tp);
}

/** Antigravity's mark: a small pixel sparkle in the corner, drawn like the creatures. */
function badgeCanvas(scale: number): HTMLCanvasElement {
  const pixels = antigravityBadge();
  const c = document.createElement("canvas");
  c.className = "ag";
  c.width = pixels[0]!.length;
  c.height = pixels.length;
  c.style.cssText = `left:${scale}px;bottom:${scale}px;width:${c.width * scale}px;height:${c.height * scale}px`;
  drawPixels(c, pixels);
  return c;
}

function closeButton(id: string): HTMLElement {
  const close = document.createElement("span");
  close.className = "x";
  close.textContent = "✕";
  close.title = "Sacar de la tira";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    const s = current(id);
    if (!s) return;
    if (s.pinned) link.send({ type: "pin", id, pinned: false });
    link.list.dismiss(s);
    hovered = null;
    render();
  });
  return close;
}

tab.addEventListener("mouseenter", () => setHover({ kind: "tab" }));
tab.addEventListener("mouseleave", () => setHover(null));
tab.addEventListener("click", toggleCollapsed);

function setHover(c: Cell | null): void {
  hovered = c;
  render();
}

function render(): void {
  const now = Date.now();
  const items = currentItems(now);
  root.className = prefs.edge;
  const key = `${prefs.edge}|${items.map((i) => (i.kind === "session" ? i.s.id + i.s.source : i.kind === "header" ? "h" + i.project : "+")).join(",")}|${workHeight}|${window.devicePixelRatio}`;
  if (key !== structureKey) {
    structureKey = key;
    rebuild(items);
    drawer.classList.toggle("collapsed", prefs.collapsed);
    drawer.style.transition = "none";
    applySlide();
    void drawer.offsetWidth;
    drawer.style.transition = "";
  }
  if (!passThrough || menuOpen) lastTouch = now; // the cursor rests on the strip or a menu is open
  else if (!prefs.collapsed && !prefs.hidden && now - lastTouch > AUTO_COLLAPSE_MS) return toggleCollapsed();
  const frame = Math.floor(now / FRAME_MS);
  if (!prefs.collapsed) { // collapsed, the cells are off screen
    const focusedId = link.list.focusedId;
    for (const [host, p] of paintables) {
      if (host === tab) continue;
      const isHover = hovered != null && (host.dataset.kind === "add" ? hovered.kind === "add" : hovered.kind === "session" && hovered.id === host.dataset.id);
      const s = shownSessions.find((x) => x.id === host.dataset.id);
      paint(p, host.dataset.kind === "add" ? addButtonLook(isHover) : sessionLook(s!, focusedId, isHover, frame, now), metrics.scale);
    }
  }
  paint(paintables.get(tab)!, tabLook(shownSessions, prefs.collapsed, prefs.edge === "right", hovered?.kind === "tab", frame, now), metrics.scale);

  const waiting = shownSessions.filter(needsAttention).length;
  if (waiting !== lastWaiting) { lastWaiting = waiting; void invoke("set_waiting", { count: waiting }); }
  updateLabel(now);
  syncWindow();
}

function applySlide(): void {
  const offset = prefs.edge === "right" ? metrics.stripW : -metrics.stripW;
  drawer.style.transform = prefs.collapsed ? `translateX(${offset}px)` : "none";
}

/** Vertically centered on `anchor`, kept inside the window. */
function placeBeside(el: HTMLElement, anchor: HTMLElement | null, nudge = 0): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const top = r.top + r.height / 2 - el.offsetHeight / 2 + nudge;
  el.style.top = `${Math.min(Math.max(4, top), Math.max(4, window.innerHeight - el.offsetHeight - 4))}px`;
}

const cellFor = (c: Cell): HTMLElement | null =>
  c.kind === "tab" ? tab : ([...paintables.keys()].find((h) => h.dataset.kind === c.kind && (c.kind !== "session" || h.dataset.id === c.id)) ?? null);

function updateLabel(now: number): void {
  const notice = link.notice;
  const noticeCell: Cell | null = notice ? (notice.sessionId ? { kind: "session", id: notice.sessionId } : { kind: "add" }) : null;
  const target = hovered ?? noticeCell;
  if (menuOpen || !target || (prefs.collapsed && target.kind !== "tab")) return void (label.style.display = "none");
  const failure = noticeCell && same(noticeCell, target) ? notice!.message : null;
  let name = "", status = "", color = "var(--muted)";
  if (target.kind === "session") {
    const s = shownSessions.find((x) => x.id === target.id);
    if (!s) return void (label.style.display = "none");
    name = s.name + (s.project && !s.name.includes(s.project) ? ` · ${s.project}` : "");
    status = failure ?? statusLine(s, now);
    if (failure) color = "var(--danger)";
    else if (needsAttention(s)) color = "var(--accent)";
  } else if (target.kind === "add") {
    name = "Fijar una sesión";
    status = failure ?? "sumá una sesión a la tira";
    if (failure) color = "var(--danger)";
  } else {
    name = prefs.collapsed ? "Expandir" : "Contraer";
    status = summary(shownSessions);
    if (shownSessions.some(needsAttention)) color = "var(--accent)";
  }
  label.replaceChildren(textDiv("n", name), textDiv("s", status));
  (label.lastChild as HTMLElement).style.color = color;
  label.style.display = "block";
  const outer = prefs.collapsed ? metrics.tabW : metrics.totalW;
  label.style.right = label.style.left = "";
  label.style[prefs.edge] = `${outer + LABEL_GAP}px`;
  placeBeside(label, cellFor(target));
}

const same = (a: Cell, b: Cell) => a.kind === b.kind && (a.kind !== "session" || (b.kind === "session" && a.id === b.id));
function textDiv(cls: string, text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

/**
 * The window keeps one size, room for the strip plus a label or menu, and lets clicks through where it's
 * transparent (see the mousemove handler). Resizing a transparent window on every hover left ghost copies on screen.
 */
function syncWindow(): void {
  const width = metrics.totalW + Math.max(MENU_W, LABEL_W);
  const k = `${width}x${workHeight}`;
  if (k === lastWindow) return;
  lastWindow = k;
  void invoke("set_layout", { width, height: workHeight });
}

function toggleCollapsed(): void {
  prefs.collapsed = !prefs.collapsed;
  lastTouch = Date.now();
  void invoke("set_pref", { key: "collapsed", value: prefs.collapsed });
  hovered = null;
  drawer.classList.toggle("collapsed", prefs.collapsed);
  applySlide();
  render();
}

function closeMenu(): void {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  veil.style.display = "none";
  menuOpen = false;
  passThrough = true; // the veil is gone; the next mouse move over the strip makes it solid again
  void invoke("set_ignore_mouse", { ignore: true });
  render();
}
veil.addEventListener("click", closeMenu);
veil.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  closeMenu();
  // A right-click on another creature opens its menu right away.
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".cell");
  if (cell?.dataset.kind === "session" && cell.dataset.id) openCreatureMenu(cell.dataset.id);
});

// Transparent parts of the window pass clicks to the app behind; Electron still forwards mouse moves here.
let passThrough = true;
document.addEventListener("mousemove", (e) => {
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const through = !hit || hit === document.body || hit === document.documentElement || hit === root || hit === drawer;
  if (through === passThrough) return;
  passThrough = through;
  void invoke("set_ignore_mouse", { ignore: through });
  if (through && hovered && !menuOpen) setHover(null);
});
let leaveTimer: number | undefined;
document.addEventListener("mouseleave", () => {
  clearTimeout(leaveTimer);
  if (menuOpen) return void (leaveTimer = window.setTimeout(() => menuOpen && closeMenu(), 1500));
  // A fast flick out skips the transparent margin: without this the window would keep blocking clicks.
  if (!passThrough) {
    passThrough = true;
    void invoke("set_ignore_mouse", { ignore: true });
  }
  if (hovered) setHover(null); // left through the screen edge: no cell saw it go
});
document.addEventListener("mouseenter", () => clearTimeout(leaveTimer));

function popUp(menu: HTMLElement, anchor: Cell): void {
  const cell = cellFor(anchor); // looked up now: a rebuild may have replaced the clicked one
  hovered = null;
  menuOpen = true;
  render();
  root.append(menu);
  veil.style.display = "block";
  passThrough = false; // the veil catches clicks anywhere in the window, to close the menu
  void invoke("set_ignore_mouse", { ignore: false });
  menu.style[prefs.edge] = `${metrics.totalW + LABEL_GAP}px`;
  const place = () => placeBeside(menu, cell, menu.offsetHeight / 2 - 14); // first row level with the creature
  place();
  new ResizeObserver(place).observe(menu); // "Personaje" and "Color" expand in place
}

function openCreatureMenu(id: string): void {
  const s = current(id);
  if (!s) return;
  if (menuOpen) closeMenu();
  popUp(creatureMenu(s, (m) => link.send(m), closeMenu), { kind: "session", id });
}

function openLibrary(): void {
  if (menuOpen) return;
  link.requestLibrary((entries: LibraryEntry[]) => popUp(libraryMenu(entries, (m) => link.send(m), closeMenu, Date.now()), { kind: "add" }));
}

async function main(): Promise<void> {
  const init = await invoke<{ prefs: Prefs; frontApp: FrontApp; workHeight: number }>("get_init");
  prefs = init.prefs;
  workHeight = init.workHeight;
  link.soundOnDone = prefs.sound;
  link.frontApp = init.frontApp;
  await listen<Prefs>("prefs", (e) => {
    prefs = { ...e.payload, collapsed: prefs.collapsed };
    link.soundOnDone = prefs.sound;
    if (prefs.hidden && menuOpen) closeMenu();
    if (prefs.hidden) hovered = null;
    render();
  });
  await listen<FrontApp>("front-app", (e) => link.setFrontApp(e.payload));
  await listen<number>("work-height", (e) => { workHeight = e.payload; render(); });
  await listen("mouse-out", () => {
    passThrough = true;
    if (hovered && !menuOpen) setHover(null);
  });
  link.start();
  render();
  setInterval(render, POLL_MS);
}

void main();
