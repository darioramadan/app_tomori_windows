// HTML popup menus (right-click on a creature, the "+" library). Built as plain DOM inside the overlay window.
import type { ClientMessage, LibraryEntry, PanelSession } from "../../shared/protocol.ts";
import { characters } from "../../site/src/domain/characters.ts";
import { palette } from "../../site/src/domain/characters.ts";
import { spriteFrame } from "../../site/src/domain/sprite.ts";
import { ago, canStop, effectiveColor, groupLibrary, stopNeedsConfirmation } from "./model.ts";

type Send = (m: ClientMessage) => void;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function item(label: string, onClick: () => void, opts: { checked?: boolean; icon?: HTMLElement; hint?: string } = {}): HTMLElement {
  const row = el("div", "mi");
  row.append(el("span", "chk", opts.checked ? "✓" : ""));
  if (opts.icon) row.append(opts.icon);
  row.append(el("span", "lbl", label));
  if (opts.hint) row.append(el("span", "hint", opts.hint));
  row.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return row;
}

function preview(character: string, color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  c.className = "pv";
  const ctx = c.getContext("2d")!;
  const t = characters.find((x) => x.id === character) ?? characters[0]!;
  spriteFrame(t, color, "idle", 1).forEach((row, y) => row.forEach((px, x) => { if (px) { ctx.fillStyle = px; ctx.fillRect(x, y, 1, 1); } }));
  return c;
}

const swatch = (color: string) => { const s = el("span", "sw"); s.style.background = color; return s; };

/** `close` dismisses the menu; sections with "▸" expand inline. */
export function creatureMenu(s: PanelSession, send: Send, close: () => void): HTMLElement {
  const menu = el("div", "menu");
  const color = effectiveColor(s);
  const go = (m: ClientMessage) => { send(m); close(); };
  menu.append(el("div", "mh", s.name));
  menu.append(item("Abrir", () => go({ type: "open", id: s.id })));
  if (s.source === "claude") menu.append(item("Nueva conversación aquí", () => go({ type: "new", id: s.id })));
  menu.append(item(s.pinned ? "Desfijar" : "Fijar", () => go({ type: "pin", id: s.id, pinned: !s.pinned })));
  if (canStop(s)) {
    const stop = item("Detener sesión", () => {
      if (stopNeedsConfirmation(s) && stop.dataset.armed !== "1") {
        stop.dataset.armed = "1";
        stop.querySelector(".lbl")!.textContent = "¿Seguro? Detener";
        return;
      }
      go({ type: "stop", id: s.id });
    });
    menu.append(stop);
  }
  menu.append(el("div", "sep"));

  const section = (title: string, icon: HTMLElement, fill: (box: HTMLElement) => void) => {
    const box = el("div", "sub");
    box.hidden = true;
    fill(box);
    const head = item(title + "  ▸", () => { box.hidden = !box.hidden; }, { icon });
    menu.append(head, box);
  };
  section("Personaje", preview(s.icon.character, color), (box) => {
    for (const c of characters) {
      box.append(item(c.label, () => go({ type: "icon", id: s.id, icon: { character: c.id, color } }), { checked: c.id === s.icon.character, icon: preview(c.id, color) }));
    }
  });
  section("Color", swatch(color), (box) => {
    for (const p of palette) {
      box.append(item(p.name, () => go({ type: "icon", id: s.id, icon: { character: s.icon.character, color: p.color } }), { checked: p.color === color.toLowerCase(), icon: swatch(p.color) }));
    }
  });
  return menu;
}

/** The library: pin or unpin a desktop session, grouped by project. */
export function libraryMenu(entries: LibraryEntry[], send: Send, close: () => void, now: number): HTMLElement {
  const menu = el("div", "menu lib");
  menu.append(el("div", "mh", "Fijar una sesión"));
  if (entries.length === 0) menu.append(el("div", "mi dim", "Sin sesiones"));
  const groups = groupLibrary(entries);
  for (const g of groups) {
    if (groups.length > 1 || g.project) menu.append(el("div", "gh", g.project ?? "Sin proyecto"));
    // The most recent Claude session gives the folder the new conversation starts in.
    const base = g.items.find((e) => e.source === "claude");
    if (base) {
      const row = item("Nueva conversación", () => { send({ type: "new", id: base.id }); close(); }, { hint: "+" });
      row.title = base.cwd;
      menu.append(row);
    }
    for (const e of g.items) {
      const row = item(e.name + (e.source === "antigravity" ? " (AG)" : e.source === "grok" ? " (Grok)" : ""), () => { send({ type: "pin", id: e.id, pinned: !e.pinned }); close(); }, { checked: e.pinned, hint: ago(e.lastActivityAt, now) });
      row.title = e.cwd;
      menu.append(row);
    }
  }
  return menu;
}
