// Writing a print page back after a placement change (ADR-0141 D3, D5).
//
// What this file may write: `views/<board_id>/<page_id>.view.teda`, and nothing else. Moving a
// symbol on a drawing is a drawing change; the circuit (`design/**`) is not touched, and no IR
// shard, no hash and no manufacturing artifact moves (ADR-0134 D5). The bytes written are the
// formatter's (ADR-0134 D10), so a save leaves a diff that shows the design change and nothing else.
//
// The change itself is a re-anchor, not a route: the wires whose pins moved keep their shape and
// get their corners back (see `packages/core/src/view/reroute.ts`). The wires of every other net,
// and every hand-made corner, are left exactly as they were.
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spanOf, type SourceMap } from "@texteda/ir";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { formatView, lex, parseSchematic, parseView, type Cell, type Line } from "@texteda/parser";
import { nearestOnPath, reanchorWire, reseatOnNet, type WireCorners } from "@texteda/core";
import { loadComponents, loadModules } from "./project.ts";
import { LAYOUT } from "./paths.ts";
import { loadSymbolLibrary, schematicInstances, type SchematicInstances } from "./symbols.ts";
import { renderSchematic, schematicGeometry, toSvgText, type SheetGeometry } from "@texteda/renderer";

/** One placement, as the app sends it. */
export interface LayoutPlace {
  instance_id: string;
  /** Millimetres, sheet coordinates (the origin is the sheet's upper-left corner). */
  x: number;
  y: number;
  /** Degrees, clockwise positive. */
  rot: number;
}

export interface LayoutRequest {
  board: string;
  page: string;
  places: LayoutPlace[];
}

export interface LayoutOutcome {
  /** The file that was written. */
  file: string;
  /** Whether the file's bytes changed. */
  changed: boolean;
  /** The wires whose shape could not be kept. */
  conflicts: string[];
  /** The labels and ports that were put back on their net. */
  reseated: string[];
}

/** What a placement change would do: the new source, and the page as it would look. */
export interface LayoutPlan extends LayoutOutcome {
  /** The page's new source, in the formatter's form. */
  text: string;
  /** The page as it would be drawn after the change. */
  svg: string;
  /** The page's geometry after the change: where the symbols and texts ended up. */
  geometry: SheetGeometry;
}

export class LayoutError extends Error {}

/** The path of a print page, relative to the project root. */
export function pageFile(board: string, page: string): string {
  return `${LAYOUT.views}/${board}/${page}.view.teda`;
}

/**
 * Move the symbols the app asks for and write the page back.
 *
 * The page's source is the input and the output: the placements the app sends are applied to the
 * parsed view, the wires that lost their pins are re-anchored, the rows that changed are rewritten
 * in the source, and the formatter makes the result canonical.
 */
export function applyLayout(root: string, request: LayoutRequest): LayoutOutcome {
  const plan = planLayout(root, request);
  commitPlan(root, plan);
  return { file: plan.file, changed: plan.changed, conflicts: plan.conflicts, reseated: plan.reseated };
}

/** Write a plan's result. The plan is the only thing that decides what is written. */
export function commitPlan(root: string, plan: LayoutPlan): void {
  if (!plan.changed) return;
  writeFile(root, plan.file, plan.text);
}

/**
 * What a placement change would do, without doing it.
 *
 * The app draws the result before it commits it (ADR-0141 D5: Apply is the commit point), so the
 * plan carries the page's new source *and* the page as it would be drawn.
 */
export function planLayout(root: string, request: LayoutRequest): LayoutPlan {
  const file = pageFile(request.board, request.page);
  const path = join(root, file);
  if (!existsSync(path)) throw new LayoutError(`no such print page: ${file}`);
  const text = readFileSync(path, "utf8");

  const facts = boardFacts(root, request.board);
  const parsed = parseView(text, { file, board: request.board });
  if (!parsed.ir) {
    const first = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new LayoutError(`${file}: ${first ? `${first.code}: ${first.message}` : "the page does not parse"}`);
  }
  const view = parsed.ir;

  const places = new Map(request.places.map((place) => [place.instance_id, place]));
  const newPlaces = view.place.map((place) => {
    const wanted = places.get(place.instance_id);
    if (wanted === undefined) return place;
    const rot = Math.round(wanted.rot / 90) * 90;
    if (Math.abs(wanted.rot - rot) > 1e-9) {
      throw new LayoutError(`${place.instance_id}: a rotation is a right angle (${wanted.rot} is not)`);
    }
    return {
      ...place,
      x_nm: Math.round(wanted.x * 1_000_000),
      y_nm: Math.round(wanted.y * 1_000_000),
      ...(rot === 0 ? {} : { rot_mdeg: rot * 1000 }),
    };
  });
  for (const wanted of request.places) {
    if (!view.place.some((place) => place.instance_id === wanted.instance_id)) {
      throw new LayoutError(`${file}: the page does not place ${wanted.instance_id}`);
    }
  }

  const moved = view.place.filter((place) => {
    const next = newPlaces.find((candidate) => candidate.instance_id === place.instance_id);
    return next !== undefined && (next.x_nm !== place.x_nm || next.y_nm !== place.y_nm || next.rot_mdeg !== place.rot_mdeg);
  });
  if (moved.length === 0) {
    const drawn = drawPage(view, facts.instances);
    return { file, text, changed: false, conflicts: [], reseated: [], ...drawn };
  }

  const before = schematicGeometry(view, facts.instances);
  const after = schematicGeometry({ ...view, place: newPlaces }, facts.instances);

  // The wires whose pins moved are re-anchored; every other wire is left byte-identical.
  const conflicts: string[] = [];
  const newWires = (view.wire ?? []).map((wire) => {
    const fromBefore = pinPoint(before, wire.from_pin);
    const toBefore = pinPoint(before, wire.to_pin);
    const fromAfter = pinPoint(after, wire.from_pin);
    const toAfter = pinPoint(after, wire.to_pin);
    if (!fromBefore || !toBefore || !fromAfter || !toAfter) return wire;
    const still =
      fromBefore.x_nm === fromAfter.x_nm &&
      fromBefore.y_nm === fromAfter.y_nm &&
      toBefore.x_nm === toAfter.x_nm &&
      toBefore.y_nm === toAfter.y_nm;
    if (still) return wire;
    const result = reanchorWire({
      net: wire.net,
      from_pin: wire.from_pin,
      to_pin: wire.to_pin,
      points: wire.points ?? [],
      from: fromBefore,
      to: toBefore,
      newFrom: fromAfter,
      newTo: toAfter,
    });
    if (result.conflict !== undefined) {
      conflicts.push(
        `${wire.net} ${wire.from_pin} → ${wire.to_pin}: the wire's shape could not be kept (${result.conflict})`,
      );
    }
    return { ...wire, points: result.points.map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm })) };
  });
  const disturbed = new Set(
    (view.wire ?? [])
      .filter((wire, index) => newWires[index] !== wire)
      .map((wire) => wire.net),
  );

  // A label or a port that the move left in the air is put back on the net it names.
  const reseated: string[] = [];
  const pathsOf = (net: string): WireCorners[][] =>
    newWires
      .filter((wire) => wire.net === net)
      .map((wire) => {
        const from = pinPoint(after, wire.from_pin);
        const to = pinPoint(after, wire.to_pin);
        const bends = (wire.points ?? []).map((point) => ({ x_nm: point.x_nm, y_nm: point.y_nm }));
        return from && to ? [from, ...bends, to] : [];
      })
      .filter((path) => path.length >= 2);
  const newLabels = (view.label ?? []).map((label) => {
    if (!disturbed.has(label.net)) return label;
    const moved2 = reseatOnNet(pathsOf(label.net), { x_nm: label.x_nm, y_nm: label.y_nm });
    if (!moved2) return label;
    reseated.push(`label ${label.net}`);
    return { ...label, x_nm: moved2.x_nm, y_nm: moved2.y_nm };
  });
  const newPorts = (view.port ?? []).map((port) => {
    const net = facts.portNets.get(port.id);
    if (net === undefined || !disturbed.has(net)) return port;
    const moved2 = reseatOnNet(pathsOf(net), { x_nm: port.x_nm, y_nm: port.y_nm });
    if (!moved2) return port;
    reseated.push(`port ${port.id}`);
    return { ...port, x_nm: moved2.x_nm, y_nm: moved2.y_nm };
  });

  const edited = rewritePage(text, {
    file,
    sources: parsed.sources ?? new Map(),
    places: newPlaces
      .map((place, index) => ({ index, place }))
      .filter(({ index, place }) => {
        const before = view.place[index]!;
        return before.x_nm !== place.x_nm || before.y_nm !== place.y_nm || before.rot_mdeg !== place.rot_mdeg;
      }),
    wires: newWires
      .map((wire, index) => ({ index, wire }))
      .filter(({ index, wire }) => !samePoints(view.wire?.[index]?.points, wire.points)),
    labels: newLabels
      .map((label, index) => ({ index, label }))
      .filter(({ index, label }) => {
        const before = view.label?.[index];
        return before !== undefined && (before.x_nm !== label.x_nm || before.y_nm !== label.y_nm);
      }),
    ports: newPorts
      .map((port, index) => ({ index, port }))
      .filter(({ index, port }) => {
        const before = view.port?.[index];
        return before !== undefined && (before.x_nm !== port.x_nm || before.y_nm !== port.y_nm);
      }),
  });
  if (edited === text) {
    const drawn = drawPage(view, facts.instances);
    return { file, text, changed: false, conflicts, reseated, ...drawn };
  }
  const drawn = drawPage(
    { ...view, place: newPlaces, wire: newWires, label: newLabels, port: newPorts },
    facts.instances,
  );
  return { file, text: edited, changed: true, conflicts, reseated, ...drawn };
}

/** The page as it is drawn: the renderer's SVG and the geometry it was drawn from. */
function drawPage(
  view: SchematicView,
  instances: SchematicInstances,
): { svg: string; geometry: SheetGeometry } {
  try {
    return { svg: toSvgText(renderSchematic(view, instances)), geometry: schematicGeometry(view, instances) };
  } catch {
    // A page that cannot be drawn is reported by the check; here it is simply not drawn.
    return { svg: "", geometry: { texts: [], fields: [], symbols: [] } };
  }
}

/**
 * Write a page's source, in the formatter's form.
 *
 * The text is checked before it is written: a page that does not parse is a page the person has to
 * fix, and writing it would leave the project in a state the tools cannot read.
 */
export function savePageSource(root: string, board: string, page: string, text: string): { file: string; changed: boolean; errors: string[] } {
  const file = pageFile(board, page);
  const formatted = formatView(text, { file });
  const errors = formatted.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (errors.length > 0 || formatted.text === undefined) return { file, changed: false, errors };
  const path = join(root, file);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (before === formatted.text) return { file, changed: false, errors: [] };
  writeFile(root, file, formatted.text);
  return { file, changed: true, errors: [] };
}

/**
 * A page's source as it would be drawn, with what the parser says about it.
 *
 * The edit mode shows the source and the drawing of the same text: the browser cannot parse a
 * `.teda` file, so the server draws it (ADR-0141 D9: the file system and the parser stay here).
 */
export function renderPageSource(
  root: string,
  board: string,
  page: string,
  text: string,
): { svg: string; errors: string[]; anchors: RowAnchor[] } {
  const file = pageFile(board, page);
  const parsed = parseView(text, { file, board });
  const errors = parsed.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (!parsed.ir) return { svg: "", errors, anchors: [] };
  const facts = boardFacts(root, board);
  return {
    svg: drawPage(parsed.ir, facts.instances).svg,
    errors,
    anchors: rowAnchors(parsed.ir, parsed.sources),
  };
}

/** One row of a page: what it is about, and the line it is on. */
export interface RowAnchor {
  /** What the row names: an instance id, a net, a port id. */
  key: string;
  kind: "place" | "wire" | "label" | "port";
  line: number;
}

/**
 * Where each row of a page is, so a click on the drawing can put the cursor on the row.
 *
 * The line comes from the parser's source map, so it is the line of the text that was parsed and
 * not of the file on disk (ADR-0103 D2).
 */
function rowAnchors(view: SchematicView, sources: SourceMap | undefined): RowAnchor[] {
  if (sources === undefined) return [];
  const anchors: RowAnchor[] = [];
  const line = (pointer: string): number | undefined => spanOf(sources, pointer)?.line;
  view.place.forEach((place, index) => {
    const at = line(`/place/${index}`);
    if (at !== undefined) anchors.push({ key: place.instance_id, kind: "place", line: at });
  });
  (view.wire ?? []).forEach((wire, index) => {
    const at = line(`/wire/${index}`);
    if (at !== undefined) anchors.push({ key: wire.net, kind: "wire", line: at });
  });
  (view.label ?? []).forEach((label, index) => {
    const at = line(`/label/${index}`);
    if (at !== undefined) anchors.push({ key: label.net, kind: "label", line: at });
  });
  (view.port ?? []).forEach((port, index) => {
    const at = line(`/port/${index}`);
    if (at !== undefined) anchors.push({ key: port.id, kind: "port", line: at });
  });
  return anchors;
}

/** The facts a page's drawing needs: the board's schematic and the symbols it places. */
export interface BoardFacts {
  schematic: Schematic;
  instances: SchematicInstances;
  /** A port id → the net it names, from the board's schematic. */
  portNets: Map<string, string>;
}

export function boardFacts(root: string, board: string): BoardFacts {
  const loaded = loadBoardFile(root, board);
  if (!loaded) throw new LayoutError(`no such board: ${board}`);
  const { resolver, shards } = loadComponents(root);
  const modules = loadModules(root);
  const symbolLibrary = loadSymbolLibrary(root);
  const componentOf = (componentId: string) => shards.find((shard) => shard.id === componentId)?.ir.component;
  const pinsOf = (componentId: string) => resolver.resolve(componentId)?.pins ?? [];
  const symbolOf = (componentId: string) => componentOf(componentId)?.symbol;
  const deviceOf = (componentId: string) => {
    const component = componentOf(componentId);
    if (component === undefined) return undefined;
    return {
      params: component.params ?? [],
      ...(component.mpn === undefined ? {} : { mpn: component.mpn }),
    };
  };
  const parsed = parseSchematic(loaded.text, {
    file: loaded.file,
    board,
    components: resolver,
    modules,
  });
  if (!parsed.ir) throw new LayoutError(`${loaded.file}: the board does not compile`);
  const schematic = parsed.ir as Schematic;
  const instances = schematicInstances(schematic, pinsOf, symbolOf, symbolLibrary, deviceOf);
  const portNets = new Map<string, string>();
  for (const port of schematic.ports ?? []) portNets.set(port.id, port.net);
  return { schematic, instances, portNets };
}

function loadBoardFile(root: string, board: string): { file: string; text: string } | undefined {
  const file = `${LAYOUT.sch}/${board}.teda`;
  const path = join(root, file);
  if (!existsSync(path)) return undefined;
  return { file, text: readFileSync(path, "utf8") };
}

/** Where a pin's connection point sits on the sheet. */
export function pinPoint(
  geometry: SheetGeometry,
  ref: string,
): { x_nm: number; y_nm: number } | undefined {
  const dot = ref.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const instance = geometry.symbols.find((symbol) => symbol.instance_id === ref.slice(0, dot));
  return instance?.pins.get(ref.slice(dot + 1));
}

/** One row of a view file: the line it is on and the cells it is made of. */
interface ViewRow {
  line: Line;
  cells: Cell[];
}

/**
 * The page's source with the changed rows rewritten.
 *
 * The rows are rewritten whole: the number of corners a wire has can change, and a row that is
 * rebuilt from its parts is easier to get right than one whose tail is patched. Each row is found
 * through the parser's source map, so a row is matched by the record it came from and not by its
 * text — two labels of the same net are two different rows. The formatter then aligns the columns.
 */
export function rewritePage(
  text: string,
  changed: {
    file: string;
    sources: SourceMap;
    places: { index: number; place: SchematicView["place"][number] }[];
    wires: { index: number; wire: NonNullable<SchematicView["wire"]>[number] }[];
    labels: { index: number; label: NonNullable<SchematicView["label"]>[number] }[];
    ports: { index: number; port: NonNullable<SchematicView["port"]>[number] }[];
  },
): string {
  const lines = text.split("\n");
  const edits: { line: number; col: number; old: string; new: string }[] = [];
  const rowOf = (path: string): ViewRow | undefined => {
    const span = spanOf(changed.sources, path);
    if (span === undefined) return undefined;
    const line = lex(text).find((candidate) => candidate.number === span.line);
    if (line === undefined || line.cells.length === 0) return undefined;
    return { line, cells: line.cells };
  };

  changed.places.forEach(({ index, place }) => {
    const row = rowOf(`/place/${index}`);
    if (!row) return;
    const cells = [place.instance_id, coord(place.x_nm), coord(place.y_nm)];
    if (place.rot_mdeg !== undefined) cells.push(String(place.rot_mdeg / 1000));
    else if (row.cells[3] !== undefined) cells.push("0");
    const unit = row.cells.find((cell) => cell.text.includes("="));
    if (unit !== undefined) cells.push(unit.text);
    edits.push(rowEdit(row, lines, cells.join("  ")));
  });

  changed.wires.forEach(({ index, wire }) => {
    const row = rowOf(`/wire/${index}`);
    if (!row) return;
    const cells = [wire.net, wire.from_pin, wire.to_pin];
    for (const point of wire.points ?? []) cells.push(coord(point.x_nm), coord(point.y_nm));
    edits.push(rowEdit(row, lines, cells.join("  ")));
  });

  changed.labels.forEach(({ index, label }) => {
    const row = rowOf(`/label/${index}`);
    if (!row) return;
    edits.push(rowEdit(row, lines, [label.net, coord(label.x_nm), coord(label.y_nm)].join("  ")));
  });

  changed.ports.forEach(({ index, port }) => {
    const row = rowOf(`/port/${index}`);
    if (!row) return;
    const cells = [port.id, coord(port.x_nm), coord(port.y_nm)];
    if (port.rot_mdeg !== undefined) cells.push(String(port.rot_mdeg / 1000));
    edits.push(rowEdit(row, lines, cells.join("  ")));
  });

  const edited = applyEdits(lines, edits);
  const formatted = formatView(edited, { file: changed.file });
  if (formatted.text === undefined) {
    const first = formatted.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new LayoutError(`${changed.file}: the rewritten page does not parse: ${first ? first.message : "unknown"}`);
  }
  return formatted.text;
}

/** An edit that replaces a row with new text. */
function rowEdit(row: ViewRow, lines: string[], next: string): { line: number; col: number; old: string; new: string } {
  const first = row.cells[0]!;
  const original = lines[row.line.number - 1] ?? "";
  const old = original.slice(first.col - 1).replace(/[ \t\r]+$/, "");
  return { line: row.line.number, col: first.col, old, new: next };
}

/** Apply the edits, right to left, so the columns of a line stay valid. */
function applyEdits(lines: string[], edits: readonly { line: number; col: number; old: string; new: string }[]): string {
  const byLine = new Map<number, { line: number; col: number; old: string; new: string }[]>();
  for (const edit of edits) {
    const group = byLine.get(edit.line);
    if (group) group.push(edit);
    else byLine.set(edit.line, [edit]);
  }
  for (const [lineNumber, group] of byLine) {
    const index = lineNumber - 1;
    const original = lines[index];
    if (original === undefined) throw new LayoutError(`internal error: edit on missing line ${lineNumber}`);
    let chars = [...original];
    group.sort((a, b) => b.col - a.col);
    for (const edit of group) {
      const start = edit.col - 1;
      const actual = chars.slice(start, start + [...edit.old].length).join("");
      if (actual !== edit.old) {
        throw new LayoutError(`internal error: line ${lineNumber} is ${JSON.stringify(actual)}, expected ${JSON.stringify(edit.old)}`);
      }
      chars = [...chars.slice(0, start), ...[...edit.new], ...chars.slice(start + [...edit.old].length)];
    }
    lines[index] = chars.join("");
  }
  return lines.join("\n");
}

/** A coordinate in the view's own notation: millimetres with at least one decimal. */
function coord(nm: number): string {
  const text = (nm / 1_000_000).toFixed(3).replace(/0+$/, "");
  return text.endsWith(".") ? `${text}0` : text;
}

/** Whether two point lists are the same list of points. */
function samePoints(
  before: readonly { x_nm: number; y_nm: number }[] | undefined,
  after: readonly { x_nm: number; y_nm: number }[] | undefined,
): boolean {
  const a = before ?? [];
  const b = after ?? [];
  return a.length === b.length && a.every((point, index) => point.x_nm === b[index]!.x_nm && point.y_nm === b[index]!.y_nm);
}

/** Write a file through a temporary name, so a crash cannot leave a half-written page. */
function writeFile(root: string, file: string, text: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.texteda-${process.pid}.tmp`);
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temporary file may already be gone; the original is untouched either way.
    }
    throw error;
  }
}
