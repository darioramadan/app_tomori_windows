// Port of StripLayout.swift sizing; the DOM does the positioning, this only measures.
import { SPRITE_SIZE } from "../../site/src/domain/sprite.ts";

export const INSET = 4;
export const TAB_PIXELS = { width: 8, height: 21 };
export const LABEL_GAP = 6;
export const GROUP_LABEL_H = 14;
export const GROUP_SEP_H = 7;
const CELL_PIXELS = SPRITE_SIZE + 4;
const SCALES = [2, 1.5, 1];

/** Height of the header above a group: its label, or a bare separator for the ungrouped tail. */
export function headerHeight(project: string | null, groupCount: number): number {
  if (project != null) return GROUP_LABEL_H;
  return groupCount > 1 ? GROUP_SEP_H : 0;
}

export interface StripMetrics {
  scale: number;
  cellSide: number;
  stripW: number;
  stripH: number;
  tabW: number;
  tabH: number;
  totalW: number;
}

/** `headers` is the summed header height; the smallest scale is used when nothing fits. */
export const BORDER = 1; // the strip's CSS border (border-box): top, bottom and the inner side

/** Scales that land every sprite pixel on whole device pixels at this display's `dpr`. */
export function scalesFor(dpr: number): number[] {
  return [...new Set(SCALES.map((s) => Math.max(1, Math.floor(s * dpr)) / dpr))];
}

export function fitting(cells: number, headers: number, available: number, dpr = 1): StripMetrics {
  const scales = scalesFor(dpr);
  const height = (scale: number) => cells * CELL_PIXELS * scale + headers + 2 * INSET + 2 * BORDER;
  const scale = scales.find((s) => height(s) <= available) ?? scales[scales.length - 1]!;
  const cellSide = CELL_PIXELS * scale;
  const stripW = cellSide + 2 * INSET + BORDER;
  const tabW = TAB_PIXELS.width * scale;
  return { scale, cellSide, stripW, stripH: Math.min(height(scale), available), tabW, tabH: TAB_PIXELS.height * scale, totalW: stripW + tabW };
}
