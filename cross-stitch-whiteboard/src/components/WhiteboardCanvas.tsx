import { useRef, useState } from 'react';
import type { Guide, Stitch, StitchMap, StitchShade, StitchType } from '../lib/model';
import { cellKey, makeStitch, parseKey } from '../lib/model';

interface Props {
  cols: number;
  rows: number;
  cell: number;
  stitches: StitchMap;
  tool: StitchType;
  shade: StitchShade;
  mode: 'stitch' | 'select';
  selection: Set<string>;
  guides: Guide[];
  onSelectionChange: (selection: Set<string>) => void;
  onGuidesChange: (guides: Guide[]) => void;
  onChange: (next: StitchMap) => void;
  /** Atomic, undoable edit (selection move / paste). */
  onEdit: (next: StitchMap) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
}

type Cell = [number, number];

interface MoveDrag {
  kind: 'move';
  start: Cell;
  minC: number;
  maxC: number;
  minR: number;
  maxR: number;
}
interface GuideDrag {
  kind: 'guide';
  id: string;
  axis: 'h' | 'v';
}
type Drag = { kind: 'marquee'; anchor: Cell } | MoveDrag | GuideDrag;

export default function WhiteboardCanvas({
  cols,
  rows,
  cell,
  stitches,
  tool,
  shade,
  mode,
  selection,
  guides,
  onSelectionChange,
  onGuidesChange,
  onChange,
  onEdit,
  onStrokeStart,
  onStrokeEnd,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const paintRef = useRef<'paint' | 'erase' | null>(null);
  const stitchesRef = useRef(stitches);
  stitchesRef.current = stitches;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const guidesRef = useRef(guides);
  guidesRef.current = guides;
  const dragRef = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ a: Cell; b: Cell } | null>(null);
  const marqueeRef = useRef(marquee);
  const [moveOffset, setMoveOffset] = useState<Cell | null>(null);
  const moveOffsetRef = useRef(moveOffset);

  const setMarqueeBoth = (m: { a: Cell; b: Cell } | null) => {
    marqueeRef.current = m;
    setMarquee(m);
  };
  const setMoveOffsetBoth = (o: Cell | null) => {
    moveOffsetRef.current = o;
    setMoveOffset(o);
  };

  const width = cols * cell;
  const height = rows * cell;
  const gx = (c: number) => c * cell;
  const gy = (r: number) => r * cell;

  const cellFromEvent = (e: React.PointerEvent, clampInside = false): Cell | null => {
    const rect = svgRef.current!.getBoundingClientRect();
    let c = Math.floor((e.clientX - rect.left) / cell);
    let r = Math.floor((e.clientY - rect.top) / cell);
    if (clampInside) {
      c = Math.min(cols - 1, Math.max(0, c));
      r = Math.min(rows - 1, Math.max(0, r));
    } else if (c < 0 || c >= cols || r < 0 || r >= rows) {
      return null;
    }
    return [c, r];
  };

  const lineFromEvent = (e: React.PointerEvent, axis: 'h' | 'v'): number => {
    const rect = svgRef.current!.getBoundingClientRect();
    if (axis === 'h') return Math.min(rows, Math.max(0, Math.round((e.clientY - rect.top) / cell)));
    return Math.min(cols, Math.max(0, Math.round((e.clientX - rect.left) / cell)));
  };

  const capture = (e: React.PointerEvent) => {
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
  };

  const sameAsTool = (s: Stitch | undefined) => s != null && s.type === tool && s.shade === shade;

  const applyCell = (key: string) => {
    const current = stitchesRef.current;
    const pm = paintRef.current;
    if (!pm) return;
    if (pm === 'paint' ? sameAsTool(current.get(key)) : !current.has(key)) return;
    const next = new Map(current);
    if (pm === 'paint') next.set(key, makeStitch(tool, shade));
    else next.delete(key);
    onChange(next);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    const guideId = (e.target as Element).getAttribute?.('data-guide');
    if (guideId && e.button === 0) {
      const g = guidesRef.current.find((x) => x.id === guideId);
      if (g) {
        e.preventDefault();
        capture(e);
        dragRef.current = { kind: 'guide', id: g.id, axis: g.axis };
        return;
      }
    }

    if (mode === 'select') {
      e.preventDefault();
      capture(e);
      const pos = cellFromEvent(e, true)!;
      const key = cellKey(pos[0], pos[1]);
      const sel = selectionRef.current;
      if (e.button === 0 && sel.has(key) && stitchesRef.current.has(key)) {
        let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
        for (const k of sel) {
          if (!stitchesRef.current.has(k)) continue;
          const [c, r] = parseKey(k);
          minC = Math.min(minC, c); maxC = Math.max(maxC, c);
          minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        }
        dragRef.current = { kind: 'move', start: pos, minC, maxC, minR, maxR };
        setMoveOffsetBoth([0, 0]);
      } else {
        dragRef.current = { kind: 'marquee', anchor: pos };
        setMarqueeBoth({ a: pos, b: pos });
      }
      return;
    }

    const key0 = cellFromEvent(e);
    if (!key0) return;
    e.preventDefault();
    capture(e);
    const k = cellKey(key0[0], key0[1]);
    const erase = e.button === 2 || e.altKey;
    paintRef.current = erase ? 'erase' : sameAsTool(stitchesRef.current.get(k)) ? 'erase' : 'paint';
    onStrokeStart();
    applyCell(k);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag?.kind === 'guide') {
      const pos = lineFromEvent(e, drag.axis);
      onGuidesChange(guidesRef.current.map((g) => (g.id === drag.id ? { ...g, pos } : g)));
      return;
    }
    if (mode === 'select') {
      if (!drag) return;
      const pos = cellFromEvent(e, true)!;
      if (drag.kind === 'marquee') setMarqueeBoth({ a: drag.anchor, b: pos });
      else if (drag.kind === 'move') {
        const dc = Math.min(cols - 1 - drag.maxC, Math.max(-drag.minC, pos[0] - drag.start[0]));
        const dr = Math.min(rows - 1 - drag.maxR, Math.max(-drag.minR, pos[1] - drag.start[1]));
        setMoveOffsetBoth([dc, dr]);
      }
      return;
    }
    const key = cellFromEvent(e);
    if (paintRef.current && key) applyCell(cellKey(key[0], key[1]));
  };

  const commitMove = (dc: number, dr: number) => {
    const current = stitchesRef.current;
    const next = new Map(current);
    const moved: [string, Stitch][] = [];
    for (const key of selectionRef.current) {
      const s = current.get(key);
      if (s == null) continue;
      next.delete(key);
      const [c, r] = parseKey(key);
      moved.push([cellKey(c + dc, r + dr), s]);
    }
    for (const [k, s] of moved) next.set(k, s);
    onEdit(next);
    onSelectionChange(new Set(moved.map(([k]) => k)));
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'guide') return;
    if (mode === 'select') {
      if (!drag) return;
      if (drag.kind === 'marquee') {
        const m = marqueeRef.current;
        setMarqueeBoth(null);
        if (!m) return;
        const c0 = Math.min(m.a[0], m.b[0]), c1 = Math.max(m.a[0], m.b[0]);
        const r0 = Math.min(m.a[1], m.b[1]), r1 = Math.max(m.a[1], m.b[1]);
        const sel = new Set<string>();
        for (const key of stitchesRef.current.keys()) {
          const [c, r] = parseKey(key);
          if (c >= c0 && c <= c1 && r >= r0 && r <= r1) sel.add(key);
        }
        onSelectionChange(sel);
      } else if (drag.kind === 'move') {
        const [dc, dr] = moveOffsetRef.current ?? [0, 0];
        setMoveOffsetBoth(null);
        if (dc !== 0 || dr !== 0) commitMove(dc, dr);
      }
      return;
    }
    if (paintRef.current) {
      paintRef.current = null;
      onStrokeEnd();
    }
  };

  const removeGuide = (id: string) => onGuidesChange(guidesRef.current.filter((g) => g.id !== id));

  const offset: Cell = moveOffset ?? [0, 0];
  const majors = [];
  for (let i = 0; i <= cols; i += 10) majors.push({ axis: 'v' as const, i });
  for (let i = 0; i <= rows; i += 10) majors.push({ axis: 'h' as const, i });

  return (
    <svg
      ref={svgRef}
      className={mode === 'select' ? 'wb-canvas is-select' : 'wb-canvas'}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <rect x={0} y={0} width={width} height={height} className="wb-fabric" />

      {/* minor grid via a tiled pattern for performance on a big canvas */}
      <defs>
        <pattern id="wb-grid" width={cell} height={cell} patternUnits="userSpaceOnUse">
          <path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" className="wb-grid-minor" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill="url(#wb-grid)" />

      {/* major grid lines every 10 */}
      {majors.map(({ axis, i }) =>
        axis === 'v' ? (
          <line key={`v${i}`} className="wb-grid-major" x1={gx(i)} y1={0} x2={gx(i)} y2={height} />
        ) : (
          <line key={`h${i}`} className="wb-grid-major" x1={0} y1={gy(i)} x2={width} y2={gy(i)} />
        )
      )}

      {/* stitches */}
      <g className="stitches">
        {[...stitches].map(([key, s]) => {
          const [bc, br] = parseKey(key);
          const sel = selection.has(key);
          const c = bc + (sel ? offset[0] : 0);
          const r = br + (sel ? offset[1] : 0);
          if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
          const inset = cell * 0.18;
          const x0 = gx(c) + inset, y0 = gy(r) + inset;
          const x1 = gx(c + 1) - inset, y1 = gy(r + 1) - inset;
          return (
            <g key={key} className={`stitch shade-${s.shade}`}>
              <rect x={gx(c)} y={gy(r)} width={cell} height={cell} className="cell-fill" />
              {s.type !== '/' && <line x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={cell * 0.2} />}
              {s.type !== '\\' && <line x1={x0} y1={y1} x2={x1} y2={y0} strokeWidth={cell * 0.2} />}
            </g>
          );
        })}
      </g>

      {/* selection highlights */}
      {[...selection].map((key) => {
        if (!stitches.has(key)) return null;
        const [c, r] = parseKey(key);
        return (
          <rect
            key={key}
            className="cell-selected"
            x={gx(c + offset[0])}
            y={gy(r + offset[1])}
            width={cell}
            height={cell}
          />
        );
      })}

      {/* marquee */}
      {marquee &&
        (() => {
          const c0 = Math.min(marquee.a[0], marquee.b[0]), c1 = Math.max(marquee.a[0], marquee.b[0]);
          const r0 = Math.min(marquee.a[1], marquee.b[1]), r1 = Math.max(marquee.a[1], marquee.b[1]);
          return (
            <rect className="marquee" x={gx(c0)} y={gy(r0)} width={(c1 - c0 + 1) * cell} height={(r1 - r0 + 1) * cell} />
          );
        })()}

      {/* draggable ruler guides (double-click to remove) */}
      {guides.map((g) => {
        const cursor = g.axis === 'h' ? 'ns-resize' : 'ew-resize';
        const [x1, y1, x2, y2] =
          g.axis === 'h' ? [0, gy(g.pos), width, gy(g.pos)] : [gx(g.pos), 0, gx(g.pos), height];
        return (
          <g key={g.id} onDoubleClick={() => removeGuide(g.id)}>
            <line
              className="wb-guide-hit"
              data-guide={g.id}
              style={{ cursor }}
              x1={x1} y1={y1} x2={x2} y2={y2}
            />
            <line className="wb-guide" x1={x1} y1={y1} x2={x2} y2={y2} />
          </g>
        );
      })}
    </svg>
  );
}
