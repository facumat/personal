/** 'x' = full cross, '/' = half stitch to the left, '\\' = half stitch to the right. */
export type StitchType = 'x' | '/' | '\\';

export const STITCH_TYPES: StitchType[] = ['x', '/', '\\'];

/** 'solid' = full black, 'muted' = 50% black. */
export type StitchShade = 'solid' | 'muted';

export const STITCH_SHADES: StitchShade[] = ['solid', 'muted'];

export interface Stitch {
  type: StitchType;
  shade: StitchShade;
}

export const makeStitch = (type: StitchType, shade: StitchShade = 'solid'): Stitch => ({
  type,
  shade,
});

export type StitchMap = Map<string, Stitch>;

/** A movable ruler line — a drawing aid only. */
export interface Guide {
  id: string;
  /** 'h' = horizontal line at a row, 'v' = vertical line at a column. */
  axis: 'h' | 'v';
  /** Grid-line index: rows from the top / columns from the left. */
  pos: number;
}

export interface Whiteboard {
  /** Canvas size in stitch cells. */
  cols: number;
  rows: number;
  /** Stitched cells, keyed "col,row" (row 0 = top). */
  stitches: StitchMap;
  guides: Guide[];
}

export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 160;

export const cellKey = (col: number, row: number) => `${col},${row}`;

export function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export const newGuideId = () => Math.random().toString(36).slice(2, 10);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

export function clampGuides(guides: Guide[], cols: number, rows: number): Guide[] {
  return guides.map((g) => ({ ...g, pos: clamp(g.pos, 0, g.axis === 'h' ? rows : cols) }));
}

export function stitchesEqual(a: StitchMap, b: StitchMap): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const o = b.get(k);
    if (!o || o.type !== v.type || o.shade !== v.shade) return false;
  }
  return true;
}

export function createWhiteboard(cols = DEFAULT_COLS, rows = DEFAULT_ROWS): Whiteboard {
  return { cols, rows, stitches: new Map(), guides: [] };
}
