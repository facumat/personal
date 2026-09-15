import type { Guide, StitchMap, StitchShade, StitchType, Whiteboard } from './model';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  STITCH_SHADES,
  STITCH_TYPES,
  clampGuides,
  createWhiteboard,
  makeStitch,
  newGuideId,
} from './model';

const KEY = 'cross-stitch-whiteboard-v1';

/** Serialized cell: a bare type string when solid, or {t, s} when shaded. */
type StitchJSON = string | { t: StitchType; s: StitchShade };

interface WhiteboardJSON {
  version: 1;
  cols: number;
  rows: number;
  stitches: Record<string, StitchJSON>;
  guides: Guide[];
}

const asType = (v: unknown): StitchType =>
  STITCH_TYPES.includes(v as StitchType) ? (v as StitchType) : 'x';
const asShade = (v: unknown): StitchShade =>
  STITCH_SHADES.includes(v as StitchShade) ? (v as StitchShade) : 'solid';

function serializeStitches(stitches: StitchMap): Record<string, StitchJSON> {
  const out: Record<string, StitchJSON> = {};
  for (const [key, s] of stitches) out[key] = s.shade === 'solid' ? s.type : { t: s.type, s: s.shade };
  return out;
}

function parseStitches(raw: unknown): StitchMap {
  const map: StitchMap = new Map();
  if (raw && typeof raw === 'object') {
    for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') map.set(key, makeStitch(asType(v)));
      else if (v && typeof v === 'object') {
        const o = v as { t?: unknown; s?: unknown };
        map.set(key, makeStitch(asType(o.t), asShade(o.s)));
      }
    }
  }
  return map;
}

function parseGuides(guides: unknown, cols: number, rows: number): Guide[] {
  if (!Array.isArray(guides)) return [];
  const valid = guides.filter(
    (g): g is Guide =>
      g != null &&
      typeof g === 'object' &&
      ((g as Guide).axis === 'h' || (g as Guide).axis === 'v') &&
      typeof (g as Guide).pos === 'number'
  );
  return clampGuides(
    valid.map((g) => ({ ...g, id: typeof g.id === 'string' ? g.id : newGuideId() })),
    cols,
    rows
  );
}

export function serializeWhiteboard(wb: Whiteboard): string {
  const data: WhiteboardJSON = {
    version: 1,
    cols: wb.cols,
    rows: wb.rows,
    stitches: serializeStitches(wb.stitches),
    guides: wb.guides,
  };
  return JSON.stringify(data, null, 2);
}

export function deserializeWhiteboard(json: string): Whiteboard {
  const data = JSON.parse(json) as WhiteboardJSON;
  const cols = typeof data.cols === 'number' ? data.cols : DEFAULT_COLS;
  const rows = typeof data.rows === 'number' ? data.rows : DEFAULT_ROWS;
  return {
    cols,
    rows,
    stitches: parseStitches(data.stitches),
    guides: parseGuides(data.guides, cols, rows),
  };
}

export function loadWhiteboard(): Whiteboard {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return deserializeWhiteboard(raw);
  } catch (err) {
    console.warn('Could not load saved whiteboard, starting fresh.', err);
  }
  return createWhiteboard();
}

export function saveWhiteboard(wb: Whiteboard): void {
  try {
    localStorage.setItem(KEY, serializeWhiteboard(wb));
  } catch (err) {
    console.warn('Could not save whiteboard.', err);
  }
}

export function clearSavedWhiteboard(): void {
  localStorage.removeItem(KEY);
}

export function downloadWhiteboardJSON(wb: Whiteboard): void {
  const blob = new Blob([serializeWhiteboard(wb)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'whiteboard.stitch.json';
  a.click();
  URL.revokeObjectURL(url);
}
