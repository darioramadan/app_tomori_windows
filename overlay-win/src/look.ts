// The add button and the collapse tab (Appearance.swift), plus a session's look on top of the site's.
import type { PanelSession } from "../../shared/protocol.ts";
import { creatureLook, type Look, type Tile } from "../../site/src/domain/appearance.ts";
import { characterNamed } from "../../site/src/domain/characters.ts";
import { outlined, SPRITE_SIZE, type Pixels } from "../../site/src/domain/sprite.ts";
import { TAB_PIXELS } from "./layout.ts";
import { effectiveColor, lookState, needsAttention } from "./model.ts";

const CONTROL = "#8b909a";
const plain: Tile = { fill: null, border: null, borderWidth: 0.75 };
const hoverFill: Tile = { ...plain, fill: "rgba(255, 255, 255, 0.12)" };
const empty = (w: number, h: number): Pixels => Array.from({ length: h }, () => Array<string | null>(w).fill(null));

export function addButtonLook(hovered: boolean): Look {
  const pixels = empty(SPRITE_SIZE, SPRITE_SIZE);
  for (let x = 8; x <= 15; x++) for (let y = 11; y <= 12; y++) pixels[y]![x] = CONTROL;
  for (let x = 11; x <= 12; x++) for (let y = 8; y <= 15; y++) pixels[y]![x] = CONTROL;
  return { pixels, tile: hovered ? hoverFill : plain, opacity: 1 };
}

export function sessionLook(s: PanelSession, focusedId: string | null, hovered: boolean, frame: number, now: number): Look {
  const focused = s.id === focusedId;
  const look = creatureLook({ character: characterNamed(s.icon.character), color: effectiveColor(s), state: lookState(s, now), frame, focused });
  let { tile } = look;
  if (hovered && !needsAttention(s)) {
    tile = focused ? { ...tile, fill: "rgba(255, 255, 255, 0.3)" } : { ...tile, fill: tile.fill ?? "rgba(255, 255, 255, 0.12)" };
  }
  return { ...look, tile };
}

/** Lower is more urgent; null carries no mark. */
function urgency(s: PanelSession, now: number): number | null {
  const state = lookState(s, now);
  if (state === "needsPermission") return 0;
  if (state === "needsInput") return 1;
  if (state === "error") return 2;
  return null;
}

/** An arrow toward the edge while open, back out while collapsed; collapsed it carries its most urgent session's mark. */
export function tabLook(sessions: PanelSession[], collapsed: boolean, edgeRight: boolean, hovered: boolean, frame: number, now: number): Look {
  const chevron = ["...X", "..XX", ".XX.", "XX..", ".XX.", "..XX", "...X"];
  const { width, height } = TAB_PIXELS;
  const left = (width - 4) >> 1;
  const top = (height - chevron.length) >> 1;
  const pointsRight = edgeRight !== collapsed;
  let pixels = empty(width, height);
  chevron.forEach((row, y) => [...row].forEach((c, x) => { if (c === "X") pixels[top + y]![left + (pointsRight ? 3 - x : x)] = CONTROL; }));

  let tile: Tile = hovered ? hoverFill : plain;
  const urgent = collapsed
    ? sessions
        .map((s) => ({ s, rank: urgency(s, now) }))
        .filter((m): m is { s: PanelSession; rank: number } => m.rank != null)
        .sort((a, b) => a.rank - b.rank)[0]?.s
    : undefined;
  if (urgent) {
    const marked = creatureLook({ character: characterNamed("default"), color: "#000000", state: lookState(urgent, now), frame }).tile;
    if (marked.fill || marked.border) tile = marked;
    if (needsAttention(urgent)) pixels = outlined(pixels);
  }
  return { pixels, tile, opacity: 1 };
}

/** Antigravity's mark: a 7×7 four-point sparkle, blue fading to violet, with a light core. */
export function antigravityBadge(): Pixels {
  const shape = ["...X...", "...X...", "..XXX..", "XXXXXXX", "..XXX..", "...X...", "...X..."];
  const hue = (x: number, y: number) => (x + y < 5 ? "#5b8cff" : x + y > 7 ? "#b06cff" : "#8a7bff");
  return shape.map((row, y) => [...row].map((c, x) => (c !== "X" ? null : x === 3 && y === 3 ? "#f2f0ff" : hue(x, y))));
}
