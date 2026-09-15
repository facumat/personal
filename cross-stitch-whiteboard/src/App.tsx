import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Guide, Stitch, StitchShade, StitchType, Whiteboard } from './lib/model';
import { cellKey, createWhiteboard, makeStitch, newGuideId, parseKey, stitchesEqual } from './lib/model';
import {
  clearSavedWhiteboard,
  deserializeWhiteboard,
  downloadWhiteboardJSON,
  loadWhiteboard,
  saveWhiteboard,
} from './lib/storage';
import WhiteboardCanvas from './components/WhiteboardCanvas';

type Stitches = Map<string, Stitch>;
const DEFAULT_CELL = 24;
const MIN_CELL = 6;
const MAX_CELL = 64;
const clampCell = (v: number) => Math.min(MAX_CELL, Math.max(MIN_CELL, Math.round(v)));

const TOOLS: { type: StitchType; label: string; title: string }[] = [
  { type: 'x', label: '✕', title: 'Full stitch' },
  { type: '/', label: '╱', title: 'Half stitch to the left' },
  { type: '\\', label: '╲', title: 'Half stitch to the right' },
];
const SHADES: { shade: StitchShade; label: string; title: string }[] = [
  { shade: 'solid', label: '■', title: 'Solid black' },
  { shade: 'muted', label: '■', title: '50% gray' },
];

const TIP =
  'Click / drag to stitch · right-click or ⌥ to unpick · pick a stitch type and shade · ' +
  '⇥ toggles select mode · in select mode drag to select an area, drag it to move, ' +
  '⌘C / ⌘V copy & paste, ⌫ delete, Esc clear selection · add ruler lines and drag them ' +
  '(double-click a ruler to remove it) · ⌘Z / ⇧⌘Z undo & redo · ⌘⌫ clear canvas · ⌘⇧⌫ reset';

interface Clip {
  cells: { c: number; r: number; stitch: Stitch }[];
  w: number;
  h: number;
  originC: number;
  originR: number;
}

export default function App() {
  const [board, setBoard] = useState<Whiteboard>(loadWhiteboard);
  const [tool, setTool] = useState<StitchType>('x');
  const [shade, setShade] = useState<StitchShade>('solid');
  const [editMode, setEditMode] = useState<'stitch' | 'select'>('stitch');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [hasClipboard, setHasClipboard] = useState(false);
  const [cell, setCell] = useState(DEFAULT_CELL);

  const boardRef = useRef(board);
  boardRef.current = board;
  const cellRef = useRef(cell);
  cellRef.current = cell;
  const scrollerRef = useRef<HTMLDivElement>(null);
  // after a zoom, keep the anchored point (cursor / viewport center) in place
  const zoomAnchorRef = useRef<{ gcx: number; gcy: number; px: number; py: number } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const historyRef = useRef<{ past: Stitches[]; future: Stitches[] }>({ past: [], future: [] });
  const strokeStartRef = useRef<Stitches | null>(null);
  const clipRef = useRef<Clip | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [, tick] = useState(0);
  const bump = () => tick((t) => t + 1);

  useEffect(() => {
    const t = setTimeout(() => saveWhiteboard(board), 400);
    return () => clearTimeout(t);
  }, [board]);

  const stitchesNow = () => boardRef.current.stitches;
  const setStitches = useCallback((next: Stitches) => setBoard((b) => ({ ...b, stitches: next })), []);
  const setGuides = useCallback((guides: Guide[]) => setBoard((b) => ({ ...b, guides })), []);

  // ---- zoom (cell size), anchored to the cursor or viewport center ----
  const applyZoom = useCallback((nextRaw: number, px?: number, py?: number) => {
    const next = clampCell(nextRaw);
    const old = cellRef.current;
    if (next === old) return;
    const sc = scrollerRef.current;
    if (sc) {
      const ax = px ?? sc.clientWidth / 2;
      const ay = py ?? sc.clientHeight / 2;
      zoomAnchorRef.current = { gcx: (sc.scrollLeft + ax) / old, gcy: (sc.scrollTop + ay) / old, px: ax, py: ay };
    }
    setCell(next);
  }, []);

  useLayoutEffect(() => {
    const a = zoomAnchorRef.current;
    const sc = scrollerRef.current;
    if (!a || !sc) return;
    sc.scrollLeft = a.gcx * cell - a.px;
    sc.scrollTop = a.gcy * cell - a.py;
    zoomAnchorRef.current = null;
  }, [cell]);

  const zoomIn = useCallback(() => applyZoom(cellRef.current * 1.25), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(cellRef.current / 1.25), [applyZoom]);
  const zoomReset = useCallback(() => applyZoom(DEFAULT_CELL), [applyZoom]);

  // ctrl/⌘ + wheel zooms toward the cursor (needs a non-passive listener)
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = sc.getBoundingClientRect();
      applyZoom(cellRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - rect.left, e.clientY - rect.top);
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, [applyZoom]);

  const pushHistory = (before: Stitches) => {
    historyRef.current.past.push(before);
    historyRef.current.future = [];
    bump();
  };

  const applyEdit = useCallback(
    (next: Stitches) => {
      const before = stitchesNow();
      if (stitchesEqual(before, next)) return;
      pushHistory(before);
      setStitches(next);
    },
    [setStitches]
  );

  const handleStrokeStart = () => {
    strokeStartRef.current = stitchesNow();
  };
  const handleStrokeEnd = () => {
    const before = strokeStartRef.current;
    strokeStartRef.current = null;
    if (before && !stitchesEqual(before, stitchesNow())) pushHistory(before);
  };

  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(stitchesNow());
    setStitches(prev);
    bump();
  }, [setStitches]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(stitchesNow());
    setStitches(next);
    bump();
  }, [setStitches]);

  const deleteSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const next = new Map(stitchesNow());
    for (const key of sel) next.delete(key);
    applyEdit(next);
    setSelection(new Set());
  }, [applyEdit]);

  const restyleSelection = (type: StitchType) => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const next = new Map(stitchesNow());
    for (const key of sel) {
      const s = next.get(key);
      if (s) next.set(key, makeStitch(type, s.shade));
    }
    applyEdit(next);
  };
  const reshadeSelection = (nextShade: StitchShade) => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const next = new Map(stitchesNow());
    for (const key of sel) {
      const s = next.get(key);
      if (s) next.set(key, makeStitch(s.type, nextShade));
    }
    applyEdit(next);
  };

  const copySelection = useCallback(() => {
    const sel = selectionRef.current;
    const cur = stitchesNow();
    const raw: { c: number; r: number; stitch: Stitch }[] = [];
    let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
    for (const key of sel) {
      const stitch = cur.get(key);
      if (!stitch) continue;
      const [c, r] = parseKey(key);
      raw.push({ c, r, stitch });
      minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    }
    if (!raw.length) return;
    clipRef.current = {
      cells: raw.map(({ c, r, stitch }) => ({ c: c - minC, r: r - minR, stitch })),
      w: maxC - minC + 1,
      h: maxR - minR + 1,
      originC: minC,
      originR: minR,
    };
    setHasClipboard(true);
  }, []);

  const pasteClipboard = useCallback(() => {
    const clip = clipRef.current;
    if (!clip) return;
    const { cols, rows } = boardRef.current;
    const tc = Math.max(0, Math.min(cols - clip.w, clip.originC + 1));
    const tr = Math.max(0, Math.min(rows - clip.h, clip.originR + 1));
    const next = new Map(stitchesNow());
    const pasted = new Set<string>();
    for (const { c, r, stitch } of clip.cells) {
      const col = tc + c, row = tr + r;
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const key = cellKey(col, row);
      next.set(key, stitch);
      pasted.add(key);
    }
    if (!pasted.size) return;
    applyEdit(next);
    setSelection(pasted);
    setEditMode('select');
  }, [applyEdit]);

  const clearCanvas = useCallback(() => {
    if (stitchesNow().size === 0) return;
    applyEdit(new Map()); // undoable with ⌘Z
    setSelection(new Set());
  }, [applyEdit]);

  const newBoard = useCallback(() => {
    historyRef.current = { past: [], future: [] };
    setSelection(new Set());
    clearSavedWhiteboard();
    setBoard(createWhiteboard());
  }, []);

  const addGuide = (axis: 'h' | 'v') => {
    const { cols, rows } = boardRef.current;
    const count = boardRef.current.guides.filter((g) => g.axis === axis).length;
    const base = axis === 'h' ? Math.round(rows / 3) : Math.round(cols / 3);
    setGuides([...boardRef.current.guides, { id: newGuideId(), axis, pos: base + count * 3 }]);
  };

  const importFile = async (file: File) => {
    try {
      historyRef.current = { past: [], future: [] };
      setSelection(new Set());
      setBoard(deserializeWhiteboard(await file.text()));
    } catch (err) {
      window.alert('Could not read that file: ' + (err instanceof Error ? err.message : err));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
      if (typing) return;
      if (e.key === 'Escape') {
        if (selectionRef.current.size > 0) setSelection(new Set());
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(new Set(stitchesNow().keys()));
        setEditMode('select');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (selectionRef.current.size) { e.preventDefault(); copySelection(); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (clipRef.current) { e.preventDefault(); pasteClipboard(); }
        return;
      }
      // ⌘⌫ clears the canvas; ⌘⇧⌫ resets everything
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        if (e.shiftKey) newBoard();
        else clearCanvas();
        return;
      }
      // ⌘+ / ⌘- / ⌘0 zoom
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); zoomOut(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); zoomReset(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        setEditMode((m) => (m === 'select' ? 'stitch' : 'select'));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectionRef.current.size) { e.preventDefault(); deleteSelection(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, copySelection, pasteClipboard, deleteSelection, clearCanvas, newBoard, zoomIn, zoomOut, zoomReset]);

  const h = historyRef.current;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cross-Stitch Whiteboard</h1>
        <span className="wb-size">
          {board.cols} × {board.rows} · {board.stitches.size} stitches
        </span>
      </header>

      <div className="wb-toolbar">
        <div className="tool-group" role="group" aria-label="Tool">
          {TOOLS.map((tl) => (
            <button
              key={tl.type}
              className={editMode === 'stitch' && tool === tl.type ? 'btn tool is-active' : 'btn tool'}
              title={tl.title}
              onClick={() => { setTool(tl.type); setEditMode('stitch'); }}
            >
              {tl.label}
            </button>
          ))}
          <button
            className={editMode === 'select' ? 'btn tool is-active' : 'btn tool'}
            title="Select area (Tab)"
            onClick={() => setEditMode('select')}
          >
            ⬚
          </button>
        </div>

        <div className="tool-group" role="group" aria-label="Shade">
          {SHADES.map((s) => (
            <button
              key={s.shade}
              className={`btn tool shade-${s.shade}${shade === s.shade ? ' is-active' : ''}`}
              title={s.title}
              onClick={() => setShade(s.shade)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button className="btn btn-quiet" onClick={undo} disabled={h.past.length === 0}>Undo</button>
        <button className="btn btn-quiet" onClick={redo} disabled={h.future.length === 0}>Redo</button>

        <div className="tool-group" role="group" aria-label="Zoom">
          <button className="btn tool" title="Zoom out (⌘−)" onClick={zoomOut} disabled={cell <= MIN_CELL}>−</button>
          <button className="btn tool zoom-pct" title="Reset zoom (⌘0)" onClick={zoomReset}>{Math.round((cell / DEFAULT_CELL) * 100)}%</button>
          <button className="btn tool" title="Zoom in (⌘+)" onClick={zoomIn} disabled={cell >= MAX_CELL}>+</button>
        </div>

        {selection.size > 0 && (
          <div className="selection-actions">
            <span>{selection.size} selected</span>
            {TOOLS.map((tl) => (
              <button key={tl.type} className="btn btn-quiet" title={`Change to ${tl.title.toLowerCase()}`} onClick={() => restyleSelection(tl.type)}>{tl.label}</button>
            ))}
            <span className="sel-divider" />
            {SHADES.map((s) => (
              <button key={s.shade} className={`btn btn-quiet shade-${s.shade}`} title={`Shade ${s.title.toLowerCase()}`} onClick={() => reshadeSelection(s.shade)}>{s.label}</button>
            ))}
            <span className="sel-divider" />
            <button className="btn btn-quiet" title="Copy (⌘C)" onClick={copySelection}>Copy</button>
            <button className="btn btn-quiet btn-danger" title="Delete (⌫)" onClick={deleteSelection}>Delete</button>
          </div>
        )}
        {hasClipboard && (
          <button className="btn btn-quiet" title="Paste (⌘V)" onClick={pasteClipboard}>Paste</button>
        )}

        <span className="toolbar-spacer" />

        <button className="btn btn-quiet" onClick={() => addGuide('h')} title="Add a horizontal ruler line">+ Row ruler</button>
        <button className="btn btn-quiet" onClick={() => addGuide('v')} title="Add a vertical ruler line">+ Col ruler</button>
        <span className="info-tip" title={TIP}>ⓘ</span>
        <button className="btn" onClick={() => downloadWhiteboardJSON(board)}>Export</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
        <button className="btn btn-danger" onClick={clearCanvas} disabled={board.stitches.size === 0} title="Clear the canvas (⌘⌫)">Clear</button>
        <button className="btn btn-quiet btn-danger" onClick={newBoard} title="Erase everything including rulers (⌘⇧⌫)">Reset</button>
      </div>

      <div className="wb-scroll" ref={scrollerRef}>
        <WhiteboardCanvas
          cols={board.cols}
          rows={board.rows}
          cell={cell}
          stitches={board.stitches}
          tool={tool}
          shade={shade}
          mode={editMode}
          selection={selection}
          guides={board.guides}
          onSelectionChange={setSelection}
          onGuidesChange={setGuides}
          onChange={setStitches}
          onEdit={applyEdit}
          onStrokeStart={handleStrokeStart}
          onStrokeEnd={handleStrokeEnd}
        />
      </div>
    </div>
  );
}
