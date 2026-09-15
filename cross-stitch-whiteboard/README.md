# Cross-Stitch Whiteboard

A big, freeform cross-stitch canvas for sketching patterns — a sibling of
`../cross-stitch-font`, seeded from it but with the font machinery removed.
No glyphs, no font export: just one large scrollable grid you draw on.

## Run it

```sh
npm install
npm run dev      # http://localhost:5273
npm run build    # typecheck + production build
```

Runs on port **5273** so it can run alongside the font builder (port 5173)
without clashing.

## What it does

- **Draw** on a large grid (120 × 160 cells): click toggles a stitch, drag
  paints a stroke, right-click or ⌥-drag unpicks. Pick a stitch type — full
  cross (✕), half stitch left (╱) or right (╲) — and a shade (solid black or
  50% gray).
- **Scroll** the canvas both directions for as much blank space as you need.
- **Ruler lines**: "+ Row ruler" / "+ Col ruler" drop a guide line; drag it
  anywhere to reposition, double-click it to remove.
- **Select** (⬚ tool or Tab): drag a marquee, drag the selection to move it,
  ⌘C / ⌘V to copy & paste, ⌫ to delete, Esc to clear. Change the type/shade
  of a selection from the toolbar.
- **Undo / redo** with ⌘Z / ⇧⌘Z (drawing, moving, pasting, deleting, clearing).
- **Clear** wipes the drawing (undoable); **Reset** starts fully over including
  rulers. **Export / Import** save and reload the board as a JSON file.

Progress autosaves to `localStorage` (key `cross-stitch-whiteboard-v1`, entirely
separate from the font builder's storage).

## Structure

```
src/
  App.tsx                     # toolbar, history, clipboard, keyboard, layout
  components/WhiteboardCanvas.tsx  # the SVG canvas: paint, select, move, rulers
  lib/model.ts                # Stitch/Shade/Guide types, Whiteboard model
  lib/storage.ts              # localStorage + JSON import/export
  lib/stitchShapes.ts         # half-stitch polygon geometry
```
