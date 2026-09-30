import type {
  CustomGuide,
  GlyphData,
  GridMetrics,
  Project,
  Stitch,
  StitchMap,
  StitchShade,
  StitchType,
} from './model';
import {
  STITCH_SHADES,
  STITCH_TYPES,
  clampGuides,
  clampMetrics,
  createProject,
  defaultMetrics,
  makeStitch,
  newGuideId,
} from './model';

const STORAGE_KEY = 'cross-stitch-font-project-v1'; // legacy single-project key
const DRAFTS_KEY = 'cross-stitch-font-drafts-v1'; // legacy single-drafts key
const LIBRARY_KEY = 'cross-stitch-font-library-v1'; // multi-font library

/** Serialized cell: a bare type string when solid, or {t, s} when shaded. */
type StitchJSON = string | { t: StitchType; s: StitchShade };
type StitchesJSON = Record<string, StitchJSON>;

interface ProjectJSON {
  version: 1;
  name: string;
  gridSize: number;
  metrics?: GridMetrics;
  guides?: CustomGuide[];
  /** stitches: oldest files store a key array, older a key→type map, now key→StitchJSON. */
  glyphs: Record<string, { stitches: string[] | StitchesJSON; advanceWidth?: number }>;
}

const asType = (v: unknown): StitchType =>
  STITCH_TYPES.includes(v as StitchType) ? (v as StitchType) : 'x';
const asShade = (v: unknown): StitchShade =>
  STITCH_SHADES.includes(v as StitchShade) ? (v as StitchShade) : 'solid';

function serializeStitches(stitches: StitchMap): StitchesJSON {
  const out: StitchesJSON = {};
  for (const [key, s] of stitches) {
    out[key] = s.shade === 'solid' ? s.type : { t: s.type, s: s.shade };
  }
  return out;
}

function parseStitches(raw: unknown): StitchMap {
  const map: StitchMap = new Map<string, Stitch>();
  if (Array.isArray(raw)) {
    for (const key of raw) if (typeof key === 'string') map.set(key, makeStitch('x'));
  } else if (raw && typeof raw === 'object') {
    for (const [key, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        map.set(key, makeStitch(asType(v)));
      } else if (v && typeof v === 'object') {
        const o = v as { t?: unknown; s?: unknown; type?: unknown; shade?: unknown };
        map.set(key, makeStitch(asType(o.t ?? o.type), asShade(o.s ?? o.shade)));
      }
    }
  }
  return map;
}

function parseGuides(guides: unknown, gridSize: number): CustomGuide[] {
  if (!Array.isArray(guides)) return [];
  const valid = guides.filter(
    (g): g is CustomGuide =>
      g != null &&
      typeof g === 'object' &&
      ((g as CustomGuide).axis === 'h' || (g as CustomGuide).axis === 'v') &&
      typeof (g as CustomGuide).pos === 'number'
  );
  return clampGuides(
    valid.map((g) => ({ ...g, id: typeof g.id === 'string' ? g.id : newGuideId() })),
    gridSize
  );
}

function isMetrics(m: unknown): m is GridMetrics {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.baselineRow === 'number' &&
    typeof o.descenderRows === 'number' &&
    typeof o.xHeightRows === 'number' &&
    typeof o.capHeightRows === 'number'
  );
}

// ---- Project <-> plain JSON (shared by file import/export and the library) ----

export function toProjectJSON(project: Project): ProjectJSON {
  const glyphs: ProjectJSON['glyphs'] = {};
  for (const [char, g] of Object.entries(project.glyphs)) {
    if (g.stitches.size === 0 && g.advanceWidth == null) continue;
    glyphs[char] = {
      stitches: serializeStitches(g.stitches),
      ...(g.advanceWidth != null ? { advanceWidth: g.advanceWidth } : {}),
    };
  }
  return {
    version: 1,
    name: project.name,
    gridSize: project.gridSize,
    metrics: project.metrics,
    guides: project.guides,
    glyphs,
  };
}

export function fromProjectJSON(data: ProjectJSON): Project {
  if (!data || typeof data !== 'object' || typeof data.gridSize !== 'number') {
    throw new Error('Not a valid cross-stitch font project file.');
  }
  const glyphs: Record<string, GlyphData> = {};
  for (const [char, g] of Object.entries(data.glyphs ?? {})) {
    glyphs[char] = {
      char,
      stitches: parseStitches(g.stitches),
      ...(typeof g.advanceWidth === 'number' ? { advanceWidth: g.advanceWidth } : {}),
    };
  }
  return {
    name: typeof data.name === 'string' ? data.name : 'My Stitch Font',
    gridSize: data.gridSize,
    metrics: isMetrics(data.metrics)
      ? clampMetrics(data.metrics, data.gridSize)
      : defaultMetrics(data.gridSize),
    guides: parseGuides(data.guides, data.gridSize),
    glyphs,
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(toProjectJSON(project), null, 2);
}

export function deserializeProject(json: string): Project {
  return fromProjectJSON(JSON.parse(json) as ProjectJSON);
}

// ---- drafts (unsaved per-glyph work) ----

export type DraftMap = Map<string, StitchMap>;

function draftsToJSON(drafts: DraftMap): Record<string, StitchesJSON> {
  const obj: Record<string, StitchesJSON> = {};
  for (const [char, stitches] of drafts) obj[char] = serializeStitches(stitches);
  return obj;
}

function draftsFromJSON(obj: unknown): DraftMap {
  const drafts: DraftMap = new Map();
  if (obj && typeof obj === 'object') {
    for (const [char, stitches] of Object.entries(obj as Record<string, unknown>)) {
      drafts.set(char, parseStitches(stitches));
    }
  }
  return drafts;
}

// ---- multi-font library ----

export interface FontEntry {
  id: string;
  project: Project;
  drafts: DraftMap;
}

export interface Library {
  fonts: FontEntry[];
  activeId: string;
}

interface LibraryJSON {
  version: 1;
  activeId: string;
  fonts: { id: string; project: ProjectJSON; drafts: Record<string, StitchesJSON> }[];
}

export const newFontId = () => 'f' + Math.random().toString(36).slice(2, 10);

export function createFontEntry(project?: Project): FontEntry {
  return { id: newFontId(), project: project ?? createProject(), drafts: new Map() };
}

function toLibraryJSON(lib: Library): LibraryJSON {
  return {
    version: 1,
    activeId: lib.activeId,
    fonts: lib.fonts.map((f) => ({
      id: f.id,
      project: toProjectJSON(f.project),
      drafts: draftsToJSON(f.drafts),
    })),
  };
}

function serializeLibrary(lib: Library): string {
  return JSON.stringify(toLibraryJSON(lib));
}

export function deserializeLibrary(json: string): Library {
  const data = JSON.parse(json) as LibraryJSON;
  const fonts: FontEntry[] = (data.fonts ?? [])
    .filter((f) => f && f.project)
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : newFontId(),
      project: fromProjectJSON(f.project),
      drafts: draftsFromJSON(f.drafts),
    }));
  if (fonts.length === 0) fonts.push(createFontEntry());
  const activeId = fonts.some((f) => f.id === data.activeId) ? data.activeId : fonts[0].id;
  return { fonts, activeId };
}

/** Parse an imported file: a full library backup yields every font, a single
 *  project file yields one. Used so Import handles both kinds transparently. */
export function parseImportFile(text: string): Project[] {
  const data = JSON.parse(text) as { fonts?: { project?: ProjectJSON }[] };
  if (data && Array.isArray(data.fonts)) {
    return data.fonts
      .filter((f) => f && f.project)
      .map((f) => fromProjectJSON(f.project as ProjectJSON));
  }
  return [fromProjectJSON(data as unknown as ProjectJSON)];
}

/** Load the library, migrating a legacy single project/drafts if present. */
export function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) return deserializeLibrary(raw);
  } catch (err) {
    console.warn('Could not load font library.', err);
  }
  // migrate an older single-project install into a one-tab library
  try {
    const rawProject = localStorage.getItem(STORAGE_KEY);
    if (rawProject) {
      const project = deserializeProject(rawProject);
      const drafts = (() => {
        try {
          const rawDrafts = localStorage.getItem(DRAFTS_KEY);
          return rawDrafts ? draftsFromJSON(JSON.parse(rawDrafts)) : new Map();
        } catch {
          return new Map<string, StitchMap>();
        }
      })();
      const entry: FontEntry = { id: newFontId(), project, drafts };
      return { fonts: [entry], activeId: entry.id };
    }
  } catch (err) {
    console.warn('Could not migrate legacy project.', err);
  }
  const entry = createFontEntry();
  return { fonts: [entry], activeId: entry.id };
}

export function saveLibrary(lib: Library): void {
  try {
    localStorage.setItem(LIBRARY_KEY, serializeLibrary(lib));
  } catch (err) {
    console.warn('Could not save font library.', err);
  }
}

// ---- file export ----

/** One JSON file containing every font in the library (a full backup). */
export function downloadLibraryJSON(lib: Library): void {
  const blob = new Blob([JSON.stringify(toLibraryJSON(lib), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'all-fonts.stitchlib.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProjectJSON(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(project.name)}.stitchfont.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'stitch-font';
}
