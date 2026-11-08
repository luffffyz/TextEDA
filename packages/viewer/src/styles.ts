// The app's own stylesheet, as one string.
//
// The app is mounted into an element the host lends it (the standalone page's `#app`, a plugin's
// slot element, an iframe's body), so every rule here is scoped to `.teda-review` — the class the
// mount puts on that element. Nothing in this file reaches `html`, `body`, `#app` or a bare tag:
// a host page keeps its own type, spacing and colours, and the app paints only its own frame.
//
// The frame's size is the host's to give: the root is `height: 100%` of what it is handed, never
// `100vh` — inside a slot a viewport height would draw past the container.
//
// The standalone document's own rules (html/body sizing, the boot placeholder) stay with the CLI,
// which owns that document; they are not part of the app.
export const APP_STYLES = `
.teda-review {
  color-scheme: dark;
  --fg: #e6e6e6;
  --muted: #9aa0a6;
  --bg: #131416;
  --panel: #1b1d21;
  --line: #2c3037;
  --accent: #6ea8fe;
  --error: #ff6b6b;
  --warning: #f0b429;
  --note: #7f8a99;

  display: grid;
  grid-template-columns: var(--sidebar-w, 260px) minmax(0, 1fr);
  height: 100%;
  min-height: 320px;
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow: hidden;
}
/*
 * A folded panel is hidden outright, and every column is placed explicitly. Hiding a grid child
 * alone would pull the remaining ones into the empty track — the sheet would land in the sidebar's
 * zero-width column — so the children name their track instead of relying on source order.
 */
.teda-review.sidebar-hidden { --sidebar-w: 0px; }
.teda-review > .sidebar { grid-column: 1; }
.teda-review > .stage-wrap { grid-column: 2; }
.teda-review.sidebar-hidden > .sidebar { display: none; }
.teda-review *, .teda-review *::before, .teda-review *::after { box-sizing: border-box; }
.teda-review aside { background: var(--panel); overflow: auto; }
.teda-review .sidebar { border-right: 1px solid var(--line); padding: 12px; }
.teda-review .project-name { font-weight: 600; font-size: 14px; }
.teda-review .project-hash { color: var(--muted); font: 11px ui-monospace, monospace; margin-bottom: 12px; }
.teda-review .page-name {
  display: block; width: 100%; text-align: left; background: none; border: 0;
  color: var(--muted); font: inherit; padding: 3px 6px 3px 18px; border-radius: 4px; cursor: pointer;
}
.teda-review .page-name:hover { background: #23262c; }
.teda-review .page-name.active { color: var(--fg); background: #262a31; }
.teda-review .page-name.problem { color: var(--warning); }
.teda-review .page-note { color: var(--muted); font-size: 11px; padding: 2px 6px 2px 18px; }
/* A kind block folds: its summary is the readable line, the marker is drawn by us. */
.teda-review .group-title {
  color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
  padding: 8px 6px 2px;
  display: flex; align-items: baseline; gap: 6px; cursor: pointer; list-style: none;
}
.teda-review .fold > summary::-webkit-details-marker { display: none; }
/* Closed points right, open points down: the marker states whether the rows are under the line. */
.teda-review .fold > summary::before { content: "\\25B8"; font-size: 9px; color: var(--muted); }
.teda-review .fold[open] > summary::before { content: "\\25BE"; }
.teda-review .fold > summary:hover { color: var(--fg); }
.teda-review .group-name { flex: 1 1 auto; }
.teda-review .group-count {
  color: var(--muted); font-size: 10px; text-transform: none; letter-spacing: 0;
}
/* A class block inside Symbols or Footprints. It is not a fold the person clicks: the rows stay
   closed and open under the pointer, so picking a drawing is one gesture rather than click-open,
   click-pick. The reveal class marks the block that holds the selected drawing, open whether or
   not the pointer is on it, and :focus-within covers walking in with Tab.

   Indentation means "this heading opens": a class heading takes one step in from its kind, and the
   drawings inside it take none of their own — their names line up under the class name. A drawing
   cannot be opened, so indenting it would claim something untrue about it, and a third level in a
   260px column leaves the names almost no room. */
.teda-review .class-block { margin-left: 10px; }
.teda-review .class-block > .group-title { cursor: default; }
.teda-review .class-block > .group-title::before { content: "\\25B8"; font-size: 9px; color: var(--muted); }
.teda-review .class-block:hover > .group-title::before,
.teda-review .class-block.reveal > .group-title::before,
.teda-review .class-block:focus-within > .group-title::before { content: "\\25BE"; }
.teda-review .class-block:hover > .group-title,
.teda-review .class-block.reveal > .group-title,
.teda-review .class-block:focus-within > .group-title { color: var(--fg); }
.teda-review .class-rows { display: none; margin-left: 10px; }
.teda-review .class-block:hover > .class-rows,
.teda-review .class-block.reveal > .class-rows,
.teda-review .class-block:focus-within > .class-rows { display: block; }
/* The leaves: what a reviewer actually picks. Their own type and a chip background separate them
   from the headings above, so a class's rows read as items and not as more headings. The chip's
   left padding lines the name up under the class name — a drawing takes no indent of its own
   (above), so the background must not push it one step further in than the heading it belongs to. */
.teda-review .class-rows .page-name {
  color: var(--fg); font-size: 12px; background: #202329; margin: 1px 0; padding: 2px 6px 2px 7px;
}
.teda-review .class-rows .page-name:hover { background: #282c33; }
.teda-review .class-rows .page-name.active { color: var(--accent); background: #262a31; }
.teda-review .class-rows .page-name.problem { color: var(--warning); }
/* A drawing that sits directly under a kind — a print page, a board canvas — is a leaf too, and
   takes the same step as a class's rows: one step for the heading it belongs to, none for itself. */
.teda-review details.fold > .page-name { padding-left: 17px; }
.teda-review .page-name .row-note { float: right; color: var(--muted); font-size: 10px; }
.teda-review .instance-list { display: flex; flex-wrap: wrap; gap: 3px; padding: 2px 6px 4px 18px; }
.teda-review .instance-name {
  background: none; border: 1px solid var(--line); border-radius: 3px; padding: 1px 4px;
  color: var(--muted); font: 10px ui-monospace, monospace; cursor: pointer;
}
.teda-review .instance-name:hover { color: var(--fg); border-color: var(--muted); }
.teda-review .instance-name.picked { color: var(--accent); border-color: var(--accent); }
.teda-review h2 {
  font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
  margin: 16px 0 6px;
}
.teda-review .diag-summary { font-size: 11px; color: var(--muted); }
.teda-review .diag-summary.has-error { color: var(--error); }
.teda-review .diag-summary.has-warning { color: var(--warning); }
.teda-review .diagnostics { list-style: none; margin: 6px 0 0; padding: 0; }
.teda-review .diag { border-left: 2px solid var(--note); padding: 3px 6px; margin-bottom: 4px; font-size: 11px; }
.teda-review .diag.error { border-color: var(--error); }
.teda-review .diag.warning { border-color: var(--warning); }
.teda-review .diag-code { display: block; font: 11px ui-monospace, monospace; color: var(--muted); }
.teda-review .diag-message { display: block; }
.teda-review .diag-where { display: block; color: var(--muted); font: 10px ui-monospace, monospace; }
.teda-review .diag-none { color: var(--muted); font-size: 11px; }
.teda-review .diag-jump {
  background: none; border: 0; padding: 0; color: var(--muted);
  font: 10px ui-monospace, monospace; cursor: pointer;
}
.teda-review .diag-jump:hover { color: var(--accent); }
.teda-review .metric-list { list-style: none; margin: 0; padding: 0; }
.teda-review .metric-list li {
  display: flex; justify-content: space-between; gap: 8px;
  color: var(--muted); font-size: 11px; padding: 1px 6px;
}
.teda-review .metric-list .metric-value { color: var(--fg); font: 11px ui-monospace, monospace; }
.teda-review .diag-toggle {
  display: block; width: 100%; margin-top: 4px; padding: 4px 6px; text-align: left;
  background: none; border: 1px solid var(--line); border-radius: 4px;
  color: var(--muted); font: inherit; font-size: 11px; cursor: pointer;
}
.teda-review .diag-toggle:hover { color: var(--fg); background: #23262c; }
.teda-review .stage-wrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.teda-review .actions {
  display: flex; align-items: center; gap: 4px; padding: 6px 10px;
  border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap;
}
.teda-review .action {
  background: none; border: 1px solid var(--line); border-radius: 4px; padding: 3px 10px;
  color: var(--muted); font: inherit; font-size: 12px; cursor: pointer;
}
.teda-review .action:hover:not(:disabled) { color: var(--fg); background: #23262c; }
.teda-review .action.active { color: var(--accent); border-color: var(--accent); }
.teda-review .action:disabled { opacity: .45; cursor: default; }
.teda-review .action-hint {
  color: var(--muted); font-size: 11px; margin-left: 10px;
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.teda-review .panes { flex: 1; display: flex; min-height: 0; }
.teda-review .source-pane {
  width: 42%; min-width: 240px; border-right: 1px solid var(--line); background: var(--panel);
  display: flex; overflow: hidden;
}
.teda-review .source-pane.hidden { display: none; }
.teda-review .source {
  flex: 1; width: 100%; border: 0; resize: none; padding: 10px 12px;
  background: var(--panel); color: var(--fg); font: 12px/1.5 ui-monospace, SFMono-Regular, monospace;
  outline: none; white-space: pre; overflow: auto;
}
.teda-review .stage {
  flex: 1; position: relative; overflow: hidden; cursor: grab;
  background: radial-gradient(circle at 50% 40%, #1a1c20, #101113 70%);
}
.teda-review .stage.dragging { cursor: grabbing; }
.teda-review .stage.empty::after {
  content: attr(data-empty); position: absolute; inset: 0; display: grid; place-items: center;
  padding: 48px; text-align: center; white-space: pre-line; color: var(--muted);
}
.teda-review .canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
 .teda-review .sheet { position: relative; box-shadow: 0 8px 32px #0008; }
 .teda-review .sheet-svg { display: block; background: #fff; }
 .teda-review .pending-symbol-overlay {
  position: absolute; inset: 0; display: block; width: 100%; height: 100%;
  overflow: visible; pointer-events: none;
}
 .teda-review .pending-symbol { opacity: .55; }
 .teda-review .pending-symbol * { stroke: #858b94 !important; }
 .teda-review .pending-symbol [fill]:not([fill="none"]) { fill: #858b94 !important; }
/* The hit rect is invisible and exactly the object's box: no stroke, because a transparent stroke
   still counts for pointer-events and would make neighbouring 0402s steal each other's hover. */
.teda-review .hotspot { fill: transparent; stroke: none; pointer-events: all; }
/* PCB hit targets pick the board's own objects; the schematic page uses its symbol selection marks. */
.teda-review .picking .hotspots, .teda-review .picking .marks { pointer-events: none; }
/* The mark is a screen annotation, not part of the drawing: its box and stroke width are written
   per zoom in sheet units by the app, so it stays 1-2 px at any magnification. No filter glow
   either: a drop-shadow blur is in the element's own units, so zooming in turns it into a blob. */
.teda-review .mark { fill: none; stroke: transparent; stroke-linejoin: round; pointer-events: none; }
.teda-review .mark.hot { stroke: var(--accent); stroke-opacity: 0.9; }
.teda-review .mark.selected { stroke: var(--accent); fill: #6ea8fe12; }
/* The net highlight on the board's canvas. The rules are per element type: a pad is a filled
   polygon, a track is a stroked polyline, and the zone's outline is neither. */
.teda-review g.net-hot[data-ref^="pad:"] polygon { fill: var(--accent); }
.teda-review g.net-hot[data-ref^="net:"] polyline { stroke: var(--accent); stroke-width: .45; }
.teda-review g.net-hot[data-ref^="net:"] circle:first-of-type { fill: var(--accent); }
.teda-review .status {
  border-top: 1px solid var(--line); padding: 6px 10px; color: var(--muted);
  font: 11px ui-monospace, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.teda-review .muted { color: var(--muted); }
.teda-review .definition { display: grid; grid-template-columns: 64px 1fr; gap: 2px 8px; margin-bottom: 10px; }
.teda-review .definition .label { color: var(--muted); }
.teda-review .members { list-style: none; margin: 4px 0 0; padding: 0; }
.teda-review .members li { display: flex; gap: 8px; padding: 2px 0; border-bottom: 1px solid var(--line); }
.teda-review .refdes, .teda-review .net-name { font: 12px ui-monospace, monospace; color: var(--accent); }
.teda-review .pins, .teda-review .component { color: var(--muted); font: 11px ui-monospace, monospace; }
.teda-review .definitions-toggle {
  display: block; width: 100%; margin: 8px 0 0; padding: 4px 6px; text-align: left;
  background: none; border: 1px solid var(--line); border-radius: 4px;
  color: var(--muted); font: inherit; font-size: 11px; cursor: pointer;
}
.teda-review .definitions-toggle:hover { color: var(--fg); background: #23262c; }
/*
 * The keyboard hint sits in the sheet's own top-left corner and never takes a slice of the frame:
 * it is an overlay on the stage, not a fourth grid track. It is resident, so it stays legible over
 * whatever the sheet draws there: the panel is nearly opaque, but the ink under it still shows
 * through, and the hint never catches a pointer, so it cannot shadow the sheet's own hotspot.
 */
.teda-review .keys-hint {
  position: absolute; left: 12px; top: 12px; z-index: 2; display: none;
  padding: 10px 12px; border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  border: 1px solid var(--line); box-shadow: 0 6px 24px #00000066;
  pointer-events: none;
}
.teda-review .keys-hint.on { display: block; }
.teda-review .keys { display: grid; gap: 4px 10px; }
.teda-review .key-row { display: flex; align-items: center; gap: 8px; }
/* The cap is the box: a rounded key, uppercase glyph, sized so a short key is a square and an
   arrow pair stays one box instead of three separate squares. */
.teda-review .key-cap {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 5px;
  border: 1px solid var(--line); border-radius: 5px;
  background: #23262c; color: var(--fg);
  font: 600 12px ui-monospace, SFMono-Regular, monospace; letter-spacing: 0.02em;
}
.teda-review .key-what { color: var(--muted); font-size: 11px; }
`;

/** The class the mount puts on the root element; every rule above is scoped to it. */
export const APP_ROOT_CLASS = "teda-review";
