// `view` description parsing: `.teda` source → the S1 advisory view IR (spec/schematic-view.md, ADR-0035, ADR-0069).
//
// The view is the drawing layer: it says where project-level symbols, module topology and declared
// interconnects are drawn. It restates no electrical fact and it never changes connectivity.
//
// What is checked here is what the file can know by itself: syntax, the right-angle rule, sheet
// bounds, and whether a referenced instance is placed. Facts that need the root are checked by the
// project cross-check, not inferred by this parser.
//
// Language 0.13 added reusable view artifacts: module drawings and sheet templates. A project page
// composes them and may draw topology without component placements (ADR-0069).
import { irVersion } from "@texteda/ir";
import type { ModuleView } from "@texteda/ir/module-view";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { SheetTemplate } from "@texteda/ir/sheet-template";
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex, type Cell, type Line } from "./lexer.ts";
import { SourceFile } from "./sources.ts";
import type { SourceMap } from "@texteda/ir/spans";
import { byteCompare, naturalCompare, pinRefCompare } from "@texteda/ir/order";
import { parseAngleMdeg, parseLengthNm } from "./units.ts";
import { checkVersion, compareVersions, typeRange, type LanguageVersion } from "./version.ts";
import { POINT, SIZE, readTupleCells, tupleShapeText } from "./tuple.ts";

/**
 * The sections of a project `view`, in canonical order (spec/schematic-view.md §11). `module` and
 * `module_port` arrived in language 0.12; `module_place` in 0.13; `interconnect` is the project-root
 * topology drawing row introduced by the logical-root cutover (ADR-0069).
 */
export const VIEW_SECTIONS = [
  "place",
  "field",
  "module",
  "module_port",
  "interconnect",
  "module_place",
  "junction",
  "wire",
  "label",
  "port",
  "text",
] as const;
export type ViewSection = (typeof VIEW_SECTIONS)[number];

const SECTION_SET = new Set<string>(VIEW_SECTIONS);
/** The sections language 0.12 added; a file below that version may not write them. */
const MODULE_SECTIONS: Record<string, true> = { module: true, module_port: true };
/** The sections language 0.13 added; a file below that version may not write them. */
const COMPOSITION_SECTIONS: Record<string, true> = { module_place: true };
/**
 * The sections a module drawing writes (ADR-0068 D2): the same drawing rows a page writes, without
 * the page's own module boxes — a module drawing draws its module, it does not draw other modules.
 */
export const MODULE_VIEW_SECTIONS = ["place", "field", "junction", "wire", "label", "port", "text"] as const;
/** The sections a sheet template writes (ADR-0068 D3): static furniture only. */
export const SHEET_TEMPLATE_SECTIONS = ["line", "rect", "polyline", "text"] as const;
/** The `place` tail keys (the section is a table with an optional key=value tail). */
const PLACE_KEYS = new Set(["unit"]);
const FIELD_NAMES = new Set(["Reference", "Value"]);
/**
 * A drawn id: a print page id, a port id, a junction id or a furniture id. A board port's id, as
 * `spec/teda.md` §7.5 writes it: a run may end at a port this page draws — the port's point comes
 * from the page's own `port` row, and the board's `ports` section says which net it names. The form
 * differs from a pin reference — no dot — so the two cannot be confused.
 */
const VIEW_ID_RE = /^[A-Za-z0-9_+-]+$/;
/**
 * A sheet template id: a slug, the shape of a page id (ADR-0068 D4). The template is named by the
 * page that uses it; the page does not define it.
 */
const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]*$/;
/** A furniture row id: a drawn id, unique in its template. */
const FURNITURE_ID_RE = /^[A-Za-z0-9_+-]+$/;
/**
 * Board-level instance id: a plain refdes (`U1`) or the module-qualified form (`M1.U1`), which the
 * module hierarchy reserves. The view names ids; it never defines them.
 */
const INSTANCE_ID_RE = /^([A-Z]+[0-9]+\.)?[A-Z]+[0-9]+$/;
/** Board-level net id; the module-qualified form (`M1.VCC`) is reserved for the module hierarchy. */
const NET_ID_RE = /^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*$/;
/** Board-level pin reference in numbered form: `<instance_id>.<pin_number>`, e.g. `U1.5`, `M1.U1.5`. */
const PIN_REF_RE = /^([A-Z]+[0-9]+\.)?[A-Z]+[0-9]+\.[A-Za-z0-9_+-]+$/;
/**
 * A module instance id: `M` + digits (spec/module.md §4). The shape belongs to module instances, so
 * a board-level refdes may not take it.
 */
const MODULE_INSTANCE_ID_RE = /^M[0-9]+$/;
/** A module id: the shape of a component id, `^[a-z][a-z0-9-]*$` (spec/module.md §1). */
const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;
/**
 * A module port reference: `<module_instance_id>.<port_id>` (spec/schematic-view.md §5). It is an
 * interface, not a pin: a board-level refdes cannot take the `M<digits>` shape, so `M1.PORT` can
 * never be read as a pin of an instance called `M1`.
 */
const MODULE_PORT_REF_RE = /^M[0-9]+\.[A-Za-z0-9_+-]+$/;
/**
 * A module drawing speaks its own module's identities (ADR-0068 D2): a local refdes (`U1`), a local
 * net (`VCC`), a local port (`SYS_OUT`). The module's namespace has no prefix — `M1.U1` belongs to
 * a board, not to the module definition the drawing belongs to.
 */
const LOCAL_INSTANCE_ID_RE = /^[A-Z]+[0-9]+$/;
const LOCAL_NET_ID_RE = /^[A-Za-z0-9_+-]+$/;
const LOCAL_PIN_REF_RE = /^[A-Z]+[0-9]+\.[A-Za-z0-9_+-]+$/;
/**
 * Language 0.12 added the module overview and the page's own size: the `size` scalar, the `module`
 * / `module_port` sections and module-port wire endpoints (ADR-0067 D6). The reader floor stays
 * 0.11 — the change is additive, so every older page stays valid — but a 0.12 construct is accepted
 * only in a file that declares 0.12 or later.
 */
export const MODULE_VIEW_VERSION: LanguageVersion = { major: 0, minor: 12, patch: 0 };
/**
 * Language 0.13 added the composition of a page: the `template` scalar and the `module_place`
 * section (ADR-0068 D4). The `view` reader floor stays 0.11 — the change is additive — but a 0.13
 * construct is accepted only in a file that declares 0.13 or later.
 */
export const COMPOSITION_VERSION: LanguageVersion = { major: 0, minor: 13, patch: 0 };
/**
 * `view` was introduced in language version 0.6 (teda.md §13); since 0.7 it names board-level ids
 * (ADR-0012), so a 0.6 view file is no longer accepted.
 */
const VERSION_RANGE = typeRange("view");
/** The reader floor of the two reusable view artifacts language 0.13 introduced (ADR-0068 D5). */
const MODULE_VIEW_RANGE = typeRange("module_view");
const SHEET_TEMPLATE_RANGE = typeRange("sheet_template");
/** A4 landscape, in nanometers. */
export const DEFAULT_SHEET_WIDTH_NM = 297_000_000;
export const DEFAULT_SHEET_HEIGHT_NM = 210_000_000;
/**
 * The view's coordinates are kept on a 0.01 mm grid, so the canonical form is lossless.
 *
 * Resolution is not the drawing lattice. Drawings are laid out on the `0.5 mm` lattice (ADR-0057
 * D4) — pin connection points, pin inner ends and wire bends all land on it. The format stays
 * finer than the lattice so historical files and hand nudges remain expressible, and so tightening
 * the lattice never has to rewrite every stored coordinate. `VIEW_GRID_NM` is therefore the
 * expressible precision, and canonical form prints any multiple of it back unchanged.
 */
export const VIEW_GRID_NM = 10_000;
/** v0.1 supports right angles only. */
const RIGHT_ANGLE_MDEG = 90_000;

export interface ViewParseOptions {
  /** File name, used for diagnostics. */
  file: string;
  /** The fixed project logical root identity. */
  project?: "main";
}

export interface ViewParseResult {
  ok: boolean;
  ir?: SchematicView;
  diagnostics: Diagnostic[];
  /** IR path → span of the record that produced it (ADR-0004 D2). Never persisted. */
  sources?: SourceMap;
}

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  error(
    file: string,
    line: number,
    col: number,
    code: DiagnosticCodeId,
    message: string,
    extra?: { expected?: string; actual?: string; hint?: string; related?: Diagnostic["related"] },
  ): void {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      location: { file, line, col },
      ...(extra?.expected !== undefined ? { expected: extra.expected } : {}),
      ...(extra?.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra?.hint !== undefined ? { hint: extra.hint } : {}),
      ...(extra?.related !== undefined ? { related: extra.related } : {}),
    });
  }

  get hasError(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

/** The raw remainder of the line starting at the given cell (1-based index), trimmed. */
function restOfLine(line: Line, from: number): string {
  const cell = line.cells[from];
  if (!cell) return "";
  // `line.text` is the trimmed original, so the leading whitespace is gone: rebase the column.
  const offset = line.cells[0]!.col - 1;
  return line.text.slice(cell.col - 1 - offset).trim();
}

/** A length on the 0.01 mm grid; the canonical form prints it back without losing information. */
function parseGridNm(
  cell: Cell,
  file: string,
  line: number,
  collector: Collector,
): number | null {
  const parsed = parseLengthNm(cell.text, file, line, cell.col, "mm", "value.length-invalid");
  if (!parsed.ok) {
    collector.diagnostics.push(parsed.diagnostic);
    return null;
  }
  if (parsed.value % VIEW_GRID_NM !== 0) {
    collector.error(file, line, cell.col, "value.length-invalid", `coordinates are limited to 0.01 mm resolution: ${cell.text}`);
    return null;
  }
  return parsed.value;
}

/**
 * Read one `[x,y]` cell (ADR-0065 D1) and both its components on the view's `0.01 mm` grid.
 * The tuple's arity is fixed here, so a row can never supply "one coordinate" and shift the rest.
 */
function parsePointCell(
  cell: Cell,
  file: string,
  line: number,
  collector: Collector,
): { x_nm: number; y_nm: number } | null {
  const parts = readTupleCells(cell, POINT, file, line, (diagnostic) => collector.diagnostics.push(diagnostic));
  if (parts === null) return null;
  const x = parseGridNm(parts[0]!, file, line, collector);
  const y = parseGridNm(parts[1]!, file, line, collector);
  if (x === null || y === null) return null;
  return { x_nm: x, y_nm: y };
}

/**
 * Read one `[w,h]` cell (ADR-0065 D1) and both its components on the view's `0.01 mm` grid.
 * A box carries its own size, which is not the page's size (spec/schematic-view.md §4.2).
 */
function parseSizeCell(
  cell: Cell,
  file: string,
  line: number,
  collector: Collector,
): { width_nm: number; height_nm: number } | null {
  const parts = readTupleCells(cell, SIZE, file, line, (diagnostic) => collector.diagnostics.push(diagnostic));
  if (parts === null) return null;
  const width = parseGridNm(parts[0]!, file, line, collector);
  const height = parseGridNm(parts[1]!, file, line, collector);
  if (width === null || height === null) return null;
  return { width_nm: width, height_nm: height };
}

/** Wire endpoint tokens are identities only; anonymous coordinate endpoints are rejected. */
function parseWireEndpoint(
  cell: Cell,
  file: string,
  line: number,
  collector: Collector,
  ctx: RowContext,
): string | null {
  if (cell.text.startsWith("@")) {
    collector.error(file, line, cell.col, "syntax.invalid-ref", `anonymous coordinate endpoints are not allowed: ${cell.text}`, {
      hint: "declare a named junction at this coordinate and use its id as the endpoint",
    });
    return null;
  }
  // A module port is an interface, not a pin: `M1.PORT` names the port `PORT` of the module
  // instance `M1` (spec/schematic-view.md §5). Language 0.12 introduced it.
  if (ctx.modulePortEndpoints && ctx.dialect.modulePort !== null && ctx.dialect.modulePort.test(cell.text)) return cell.text;
  if (ctx.dialect.pinRef.test(cell.text) || ctx.dialect.id.test(cell.text)) return cell.text;
  collector.error(file, line, cell.col, "syntax.invalid-ref", `not a valid pin reference, port id or junction id: ${cell.text}`);
  return null;
}

/** A rotation: right angles only, reduced modulo a full turn. */
function parseRotation(
  cell: Cell,
  file: string,
  line: number,
  collector: Collector,
): number | null {
  const parsed = parseAngleMdeg(cell.text, file, line, cell.col, "deg", "value.angle-invalid");
  if (!parsed.ok) {
    collector.diagnostics.push(parsed.diagnostic);
    return null;
  }
  const mdeg = ((parsed.value % 360_000) + 360_000) % 360_000;
  if (mdeg % RIGHT_ANGLE_MDEG !== 0) {
    collector.error(file, line, cell.col, "value.angle-invalid", `v0.1 supports right angles only (0/90/180/270): ${cell.text}`);
    return null;
  }
  return mdeg;
}

/**
 * The rotation of a placed module drawing: a right angle only, as the IR types it (ADR-0068 D4). A
 * rotation of zero is the default, so the IR omits it.
 */
function parsePlacementRotation(
  cell: Cell,
  file: string,
  line: number,
  collector: Collector,
): 0 | 90000 | 180000 | 270000 | null {
  const parsed = parseRotation(cell, file, line, collector);
  if (parsed === null) return null;
  switch (parsed) {
    case 0:
      return 0;
    case 90000:
      return 90000;
    case 180000:
      return 180000;
    case 270000:
      return 270000;
    default:
      // parseRotation accepts right angles only, so this branch cannot be reached.
      collector.error(file, line, cell.col, "value.angle-invalid", `a placed drawing turns by a right angle only (0/90/180/270): ${cell.text}`);
      return null;
  }
}

/**
 * The identity dialect a drawing speaks.
 *
 * A board page names board-level identities: an instance may carry its module's prefix (`M1.U1`), a
 * net may be module-qualified (`M1.VCC`), and a wire may end at a module port (`M1.PORT`). A module
 * drawing names the identities of the module definition it belongs to — `U1`, `VCC`, `SYS_OUT` —
 * with no prefix (ADR-0068 D2). The row semantics are the same; only the names differ.
 */
interface Dialect {
  /** An instance id. */
  instance: RegExp;
  /** A net id. */
  net: RegExp;
  /** A pin reference: `<instance_id>.<pin_number>`. */
  pinRef: RegExp;
  /** A drawn id: a port id or a junction id. */
  id: RegExp;
  /** A module port reference (`<module_instance_id>.<port_id>`); a module drawing has none. */
  modulePort: RegExp | null;
}

/** The board-level dialect: the ids of `spec/schematic-view.md`. */
const BOARD_DIALECT: Dialect = {
  instance: INSTANCE_ID_RE,
  net: NET_ID_RE,
  pinRef: PIN_REF_RE,
  id: VIEW_ID_RE,
  modulePort: MODULE_PORT_REF_RE,
};

/** The module-local dialect: the ids inside one module definition. */
const MODULE_DIALECT: Dialect = {
  instance: LOCAL_INSTANCE_ID_RE,
  net: LOCAL_NET_ID_RE,
  pinRef: LOCAL_PIN_REF_RE,
  id: VIEW_ID_RE,
  modulePort: null,
};

/** What a row parser needs: the file, the diagnostics and the identity dialect. */
interface RowContext {
  file: string;
  collector: Collector;
  /** The source file, for the `related` span of a duplicate id. */
  src: SourceFile;
  /** The identity dialect the drawing speaks. */
  dialect: Dialect;
  /** Whether a wire may end at a module port (`M1.PORT`): board pages from language 0.12 on. */
  modulePortEndpoints: boolean;
  /** Where each junction id was declared. */
  junctionAt: Map<string, { line: number; col: number }>;
  /** Where each field was declared, keyed by instance and name. */
  fieldAt: Map<string, { line: number; col: number }>;
  /**
   * Line of each record, by object identity. A line number is a function of the line order, so it
   * cannot enter the IR (ADR-0004 D1); it is kept beside it for this parse only.
   */
  at: Map<object, number>;
}

/** The rows a drawing is made of: the seven sections a page and a module drawing share. */
interface DrawingRows {
  place: NonNullable<SchematicView["place"]>;
  field: NonNullable<SchematicView["field"]>;
  junction: NonNullable<SchematicView["junction"]>;
  wire: NonNullable<SchematicView["wire"]>;
  label: NonNullable<SchematicView["label"]>;
  port: NonNullable<SchematicView["port"]>;
  text: NonNullable<SchematicView["text"]>;
}
type ViewInterconnect = NonNullable<SchematicView["interconnect"]>[number];

/** An advisory interconnect row: `id from to [point] [<rot>]`. */
function parseInterconnectRow(cells: Cell[], line: number, ctx: RowContext): ViewInterconnect | null {
  const { file, collector } = ctx;
  if (cells.length < 3 || cells.length > 5) {
    collector.error(file, line, cells[0]!.col, "syntax.column-count", "an interconnect row has 3 to 5 columns: id from to [point] [rotation]");
    return null;
  }
  const id = cells[0]!.text;
  if (!VIEW_ID_RE.test(id)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid interconnect id: ${id}`);
    return null;
  }
  const from = cells[1]!.text;
  const to = cells[2]!.text;
  if (!MODULE_PORT_REF_RE.test(from) || !MODULE_PORT_REF_RE.test(to)) {
    collector.error(file, line, cells[1]!.col, "syntax.invalid-ref", "interconnect endpoints must be module ports such as M1.POWER");
    return null;
  }
  let point: { x_nm: number; y_nm: number } | null = null;
  let rot: 0 | 90000 | 180000 | 270000 | undefined;
  if (cells.length >= 4) {
    point = parsePointCell(cells[3]!, file, line, collector);
    if (point === null) return null;
  }
  if (cells.length === 5) {
    const parsed = parsePlacementRotation(cells[4]!, file, line, collector);
    if (parsed === null) return null;
    rot = parsed === 0 ? undefined : parsed;
  }
  return { id, from, to, ...(point === null ? {} : point), ...(rot === undefined ? {} : { rot_mdeg: rot }) };
}

/** A `place` row: `instance_id [x,y] [<rot>] [<key=value> …]`. */
function parsePlaceRow(cells: Cell[], line: number, ctx: RowContext): NonNullable<SchematicView["place"]>[number] | null {
  const { file, collector } = ctx;
  if (cells.length < 2) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", `a place row needs at least 2 columns: instance_id ${tupleShapeText(POINT)}`);
    return null;
  }
  const instanceId = cells[0]!.text;
  if (!ctx.dialect.instance.test(instanceId)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid instance id: ${instanceId}`);
    return null;
  }
  const point = parsePointCell(cells[1]!, file, line, collector);
  if (point === null) return null;
  let rot: number | undefined;
  let unit: number | undefined;
  for (const cell of cells.slice(2)) {
    const eq = cell.text.indexOf("=");
    if (eq <= 0) {
      if (rot === undefined) {
        const parsed = parseRotation(cell, file, line, collector);
        if (parsed === null) continue;
        // A zero rotation is the default: the IR omits it, so `0` and "no rot" are the same file.
        rot = parsed === 0 ? undefined : parsed;
        continue;
      }
      collector.error(file, line, cell.col, "syntax.invalid-token", `unrecognized cell: ${cell.text}`);
      continue;
    }
    const key = cell.text.slice(0, eq);
    if (!PLACE_KEYS.has(key)) {
      collector.error(file, line, cell.col, "syntax.unknown-field", `unknown key: ${key}`);
      continue;
    }
    if (key === "unit") {
      const raw = cell.text.slice(eq + 1);
      if (!/^\d+$/.test(raw) || Number(raw) < 1) {
        collector.error(file, line, cell.col, "value.invalid-value", `unit must be a positive integer: ${raw}`);
        continue;
      }
      unit = Number(raw);
      // Unit 1 is the default: the IR omits it, so `unit=1` and "no unit" are the same file.
      if (unit === 1) unit = undefined;
    }
  }
  return {
    instance_id: instanceId,
    ...point,
    ...(rot === undefined ? {} : { rot_mdeg: rot }),
    ...(unit === undefined ? {} : { unit }),
  };
}

/** A `field` row: `instance_id name [x,y]`. */
function parseFieldRow(cells: Cell[], line: number, ctx: RowContext): NonNullable<SchematicView["field"]>[number] | null {
  const { file, collector, src } = ctx;
  if (cells.length < 3) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", `a field row needs 3 columns: instance_id name ${tupleShapeText(POINT)}`);
    return null;
  }
  if (cells.length > 3) {
    collector.error(file, line, cells[3]!.col, "syntax.invalid-token", `a field row has exactly 3 columns: instance_id name ${tupleShapeText(POINT)}`);
    return null;
  }
  const instanceId = cells[0]!.text;
  if (!ctx.dialect.instance.test(instanceId)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid instance id: ${instanceId}`);
    return null;
  }
  const nameText = cells[1]!.text;
  if (!FIELD_NAMES.has(nameText)) {
    collector.error(file, line, cells[1]!.col, "syntax.invalid-literal", `field name must be Reference or Value: ${nameText}`, {
      expected: "Reference or Value",
      actual: nameText,
    });
    return null;
  }
  const name = nameText as "Reference" | "Value";
  const point = parsePointCell(cells[2]!, file, line, collector);
  if (point === null) return null;
  const key = `${instanceId}\u0000${name}`;
  const previous = ctx.fieldAt.get(key);
  if (previous !== undefined) {
    collector.error(file, line, cells[1]!.col, "value.duplicate-field", `duplicate field ${name} for instance ${instanceId}`, {
      related: [src.span(previous.line, previous.col)],
    });
    return null;
  }
  ctx.fieldAt.set(key, { line, col: cells[1]!.col });
  return { instance_id: instanceId, name, ...point };
}

/** A `junction` row: `id [x,y]`. */
function parseJunctionRow(cells: Cell[], line: number, ctx: RowContext): NonNullable<SchematicView["junction"]>[number] | null {
  const { file, collector, src } = ctx;
  if (cells.length !== 2) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", `a junction row has exactly two columns: id ${tupleShapeText(POINT)}`);
    return null;
  }
  const id = cells[0]!.text;
  if (!ctx.dialect.id.test(id)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid junction id: ${id}`);
    return null;
  }
  const point = parsePointCell(cells[1]!, file, line, collector);
  if (point === null) return null;
  const previous = ctx.junctionAt.get(id);
  if (previous) {
    collector.error(file, line, cells[0]!.col, "value.duplicate-id", `duplicate junction id ${id}`, { related: [src.span(previous.line, previous.col)] });
    return null;
  }
  ctx.junctionAt.set(id, { line, col: cells[0]!.col });
  return { id, ...point };
}

/** A `wire` row: `net from_pin to_pin [<bend> …]`. */
function parseWireRow(cells: Cell[], line: number, ctx: RowContext): NonNullable<SchematicView["wire"]>[number] | null {
  const { file, collector } = ctx;
  if (cells.length < 3) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", "a wire row needs at least 3 columns: net from_pin to_pin");
    return null;
  }
  const net = cells[0]!.text;
  if (!ctx.dialect.net.test(net)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid net id: ${net}`);
    return null;
  }
  const endpoints = [cells[1]!, cells[2]!].map((cell) => parseWireEndpoint(cell, file, line, collector, ctx));
  if (endpoints.some((endpoint) => endpoint === null)) return null;
  const [fromPin, toPin] = endpoints as [string, string];
  const points: { x_nm: number; y_nm: number }[] = [];
  for (const cell of cells.slice(3)) {
    const point = parsePointCell(cell, file, line, collector);
    if (point === null) return null;
    points.push(point);
  }
  return { net, from_pin: fromPin, to_pin: toPin, ...(points.length > 0 ? { points } : {}) };
}

/** A `label` row: `net [x,y]`. */
function parseLabelRow(cells: Cell[], line: number, ctx: RowContext): NonNullable<SchematicView["label"]>[number] | null {
  const { file, collector } = ctx;
  if (cells.length !== 2) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", `a label row has exactly 2 columns: net ${tupleShapeText(POINT)}`);
    return null;
  }
  const net = cells[0]!.text;
  if (!ctx.dialect.net.test(net)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid net id: ${net}`);
    return null;
  }
  const point = parsePointCell(cells[1]!, file, line, collector);
  if (point === null) return null;
  return { net, ...point };
}

/** A `port` row: `id [x,y] [<rot>]`. */
function parsePortRow(cells: Cell[], line: number, ctx: RowContext): NonNullable<SchematicView["port"]>[number] | null {
  const { file, collector } = ctx;
  if (cells.length < 2) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", `a port row needs at least 2 columns: port_id ${tupleShapeText(POINT)}`);
    return null;
  }
  const id = cells[0]!.text;
  if (!ctx.dialect.id.test(id)) {
    collector.error(file, line, cells[0]!.col, "syntax.invalid-token", `not a valid port id: ${id}`);
    return null;
  }
  const point = parsePointCell(cells[1]!, file, line, collector);
  if (point === null) return null;
  let rot: number | undefined;
  if (cells.length > 2) {
    const parsed = parseRotation(cells[2]!, file, line, collector);
    if (parsed === null) return null;
    rot = parsed === 0 ? undefined : parsed;
  }
  return { id, ...point, ...(rot === undefined ? {} : { rot_mdeg: rot }) };
}

/** A `text` row: `[x,y] <text>` — the text is the rest of the line. */
function parseTextRow(cells: Cell[], source: Line, line: number, ctx: RowContext): NonNullable<SchematicView["text"]>[number] | null {
  const { file, collector } = ctx;
  if (cells.length < 2) {
    collector.error(file, line, cells[0]!.col, "syntax.row-too-short", `a text row needs 2 columns: ${tupleShapeText(POINT)} text`);
    return null;
  }
  const point = parsePointCell(cells[0]!, file, line, collector);
  if (point === null) return null;
  const body = restOfLine(source, 1);
  if (body.length === 0) {
    collector.error(file, line, cells[1]!.col, "syntax.row-too-short", "a text row needs some text");
    return null;
  }
  return { ...point, text: body };
}

/**
 * The checks a drawing makes about itself: the endpoints it names, the fields it anchors and the
 * geometry that has to fit the page. Everything that needs another file is not here.
 */
function checkDrawing(
  rows: DrawingRows,
  ctx: RowContext,
  /**
   * The extent of the drawing, or `null` when this file does not know it: a page that uses a sheet
   * template takes its extent from the template, which the page does not carry (ADR-0068 D4). The
   * geometry is then checked where the template is loaded, not here.
   */
  bounds: { width_nm: number; height_nm: number } | null,
  /** The module boxes a board page draws; checked between the places and the wires. */
  boxes: readonly { x_nm: number; y_nm: number; width_nm: number; height_nm: number }[] = [],
  /** The module ports a board page draws. */
  modulePorts: readonly { x_nm: number; y_nm: number }[] = [],
  /** What the extent is called in the diagnostic: a page's sheet, a module drawing's bounds. */
  extent = "the sheet",
): void {
  const { file, collector } = ctx;
  const at = ctx.at;
  const placed = new Set(rows.place.map((p) => p.instance_id));
  const drawnPorts = new Set(rows.port.map((item) => item.id));
  const junctionIds = new Set(rows.junction.map((item) => item.id));
  for (const item of rows.junction) {
    if (drawnPorts.has(item.id)) collector.error(file, at.get(item) ?? 1, 1, "value.duplicate-id", `junction id ${item.id} conflicts with a page port id`);
    if (bounds !== null) checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
  for (const item of rows.wire) {
    for (const ref of [item.from_pin, item.to_pin]) {
      if (ctx.modulePortEndpoints && ctx.dialect.modulePort !== null && ctx.dialect.modulePort.test(ref)) {
        // A module port is an interface of a module instance, not a pin of a placed instance: the
        // box it belongs to is drawn in the `module` section (spec/schematic-view.md §5).
        continue;
      }
      if (ref.includes(".")) {
        const instanceId = ref.slice(0, ref.lastIndexOf("."));
        if (!placed.has(instanceId)) collector.error(file, at.get(item) ?? 1, 1, "view.pin-not-placed", `the instance ${instanceId} of pin ${ref} is not in the place section`);
      } else if (drawnPorts.has(ref)) {
        // A run that ends at a port takes its point from the page's own `port` row (ADR-0062 D1).
        continue;
      } else if (junctionIds.has(ref)) {
        // A run that ends at a junction takes its point from the page's own `junction` row.
        continue;
      } else {
        // Neither drawn on this page: there is no point for the run to end at. Whether the id names a
        // board port or nothing at all is the board cross-check's question, not the page's.
        collector.error(
          file,
          at.get(item) ?? 1,
          1,
          "view.port-not-drawn",
          `the run ${item.net} ${item.from_pin} → ${item.to_pin} ends at ${ref}, which this page draws neither as a port nor as a junction`,
        );
      }
    }
  }
  for (const item of rows.field) {
    if (!placed.has(item.instance_id)) {
      collector.error(
        file,
        at.get(item) ?? 1,
        1,
        "ref.unknown-instance",
        `the field ${item.name} references instance ${item.instance_id}, which is not in the place section`,
      );
    }
  }

  // The geometry needs the extent; without it, only the checks above apply.
  if (bounds === null) return;

  for (const item of rows.place) {
    checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
  for (const box of boxes) {
    checkBoxOnSheet(file, at.get(box) ?? 1, box.x_nm, box.y_nm, box.width_nm, box.height_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
  for (const item of modulePorts) {
    checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
  for (const item of rows.wire) {
    for (const point of item.points ?? []) {
      checkOnSheet(file, at.get(item) ?? 1, point.x_nm, point.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
    }
  }
  for (const item of rows.label) {
    checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
  for (const item of rows.port) {
    checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
  for (const item of rows.text) {
    checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, bounds.width_nm, bounds.height_nm, collector, extent);
  }
}

/**
 * Parse a `view` description.
 *
 * The print page id comes from the type line (`view <page_id>`); the board id comes from the directory
 * `sch/<board_id>/` and is passed in by the caller.
 */
export function parseView(text: string, options: ViewParseOptions): ViewParseResult {
  const collector = new Collector();
  const { file } = options;
  const lexed = lex(text);
  const src = new SourceFile(file, lexed);
  const lines = lexed;
  /**
   * Line of each record, by object identity. A line number is a function of the line order, so it
   * cannot enter the IR (ADR-0004 D1); it is kept beside it for this parse only.
   */
  const at = new Map<object, number>();

  let index = 0;
  const nextMeaningful = (): Line | null => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = nextMeaningful();
  if (!versionLine || versionLine.cells.length !== 2 || versionLine.cells[0]!.text !== "version") {
    collector.error(file, versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const version = versionLine.cells[1]!.text;
  const verdict = checkVersion(version, VERSION_RANGE, "view");
  if (!verdict.ok) {
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message, {
      ...(verdict.hint === undefined ? {} : { hint: verdict.hint }),
    });
    return { ok: false, diagnostics: collector.diagnostics };
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "view") {
    collector.error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be view <page_id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const page = typeLine.cells[1]!.text;
  if (!VIEW_ID_RE.test(page)) {
    collector.error(file, typeLine.number, typeLine.cells[1]!.col, "syntax.invalid-token", `not a valid print page id: ${page}`);
  }

  /**
   * Whether this file may use the language 0.12 constructs: the `size` scalar, the `module` /
   * `module_port` sections and module-port wire endpoints (ADR-0067 D6). A file that declares an
   * older version does not have them, whatever it writes.
   */
  const moduleSyntax = compareVersions(verdict.version, MODULE_VIEW_VERSION) >= 0;
  /**
   * Whether this file may use the language 0.13 constructs: the `template` scalar and the
   * `module_place` section (ADR-0068 D4). A file that declares an older version does not have
   * them, whatever it writes.
   */
  const compositionSyntax = compareVersions(verdict.version, COMPOSITION_VERSION) >= 0;

  let section: ViewSection | null = null;
  let sheetWidth = DEFAULT_SHEET_WIDTH_NM;
  let sheetHeight = DEFAULT_SHEET_HEIGHT_NM;
  /** The page-size scalar, once: `size` in language 0.12, its alias `sheet` in every version. */
  let sizeAt: { key: string; line: number; col: number } | null = null;
  /** The sheet template of the page, once: `template <template_id>` (language 0.13). */
  let template: string | null = null;
  let templateAt: { line: number; col: number } | null = null;
  const place: NonNullable<SchematicView["place"]> = [];
  const fields: NonNullable<SchematicView["field"]> = [];
  const fieldAt = new Map<string, { line: number; col: number }>();
  const modules: NonNullable<SchematicView["module"]> = [];
  const moduleAt = new Map<string, { line: number; col: number }>();
  const modulePorts: NonNullable<SchematicView["module_port"]> = [];
  const modulePortAt = new Map<string, { line: number; col: number }>();
  const interconnects: NonNullable<SchematicView["interconnect"]> = [];
  const interconnectAt = new Map<string, { line: number; col: number }>();
  const modulePlaces: NonNullable<SchematicView["module_place"]> = [];
  const modulePlaceAt = new Map<string, { line: number; col: number }>();
  const wire: NonNullable<SchematicView["wire"]> = [];
  const label: NonNullable<SchematicView["label"]> = [];
  const port: NonNullable<SchematicView["port"]> = [];
  const texts: NonNullable<SchematicView["text"]> = [];
  const junction: NonNullable<SchematicView["junction"]> = [];
  const junctionAt = new Map<string, { line: number; col: number }>();
  /** What the shared row parsers work on: the file, the diagnostics and the board-level dialect. */
  const ctx: RowContext = {
    file,
    collector,
    src,
    dialect: BOARD_DIALECT,
    modulePortEndpoints: moduleSyntax,
    junctionAt,
    fieldAt,
    at,
  };
  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1 && SECTION_SET.has(line.cells[0]!.text)) {
      const name = line.cells[0]!.text as ViewSection;
      if (MODULE_SECTIONS[name] === true && !moduleSyntax) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-section", `the ${name} section needs language 0.12`, {
          hint: "the module overview arrived in language 0.12; a page below that version has no module boxes",
        });
      }
      if (COMPOSITION_SECTIONS[name] === true && !compositionSyntax) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-section", `the ${name} section needs language 0.13`, {
          hint: "placing module drawings arrived in language 0.13; a page below that version draws no module drawings",
        });
      }
      section = name;
      continue;
    }

    if (section === null) {
      // A scalar: the page size, `size [w,h]` or its alias `sheet [w,h]` (spec/schematic-view.md §2).
      const key = line.cells[0]!.text;
      if (key === "template") {
        // The sheet template of the page arrived in language 0.13 (ADR-0068 D4).
        if (!compositionSyntax) {
          collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${key}`, {
            hint: "the template key needs language 0.13; a page below that version has no sheet template",
          });
          continue;
        }
        if (templateAt !== null) {
          collector.error(file, line.number, line.cells[0]!.col, "syntax.duplicate-key", `duplicate page-template key: ${key}`, {
            related: [src.span(templateAt.line, templateAt.col)],
          });
          continue;
        }
        const parts = line.cells.slice(1);
        if (parts.length !== 1) {
          collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", "the template scalar is one cell: template <template_id>");
          continue;
        }
        const id = parts[0]!.text;
        if (!TEMPLATE_ID_RE.test(id)) {
          collector.error(file, line.number, parts[0]!.col, "syntax.invalid-token", `not a valid template id: ${id}`);
          continue;
        }
        if (sizeAt !== null) {
          collector.error(file, line.number, line.cells[0]!.col, "syntax.duplicate-key", "the page extent is declared twice: template and page size are two spellings of one fact", {
            hint: "the template's size is the page's size; drop the page-size key",
            related: [src.span(sizeAt.line, sizeAt.col)],
          });
          continue;
        }
        template = id;
        templateAt = { line: line.number, col: line.cells[0]!.col };
        continue;
      }
      if (key !== "size" && key !== "sheet") {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${key}`);
        continue;
      }
      if (templateAt !== null) {
        // The template's size is the page's extent: a page declares its extent once (ADR-0068 D4).
        collector.error(file, line.number, line.cells[0]!.col, "syntax.duplicate-key", `the page extent is declared twice: template and ${key} are two spellings of one fact`, {
          hint: "the template's size is the page's size; drop the page-size key",
          related: [src.span(templateAt.line, templateAt.col)],
        });
        continue;
      }
      if (key === "size" && !moduleSyntax) {
        // `size` arrived in language 0.12; before that the key did not exist.
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${key}`, {
          hint: "the page-size key `size` needs language 0.12; a page below that version writes `sheet`",
        });
        continue;
      }
      if (sizeAt !== null) {
        // The two keys are two spellings of one fact: a page declares its size once (ADR-0067 D6).
        const other =
          sizeAt.key === key
            ? `duplicate page-size key: ${key}`
            : `the page size is declared twice: ${sizeAt.key} and ${key} are two spellings of one fact`;
        collector.error(file, line.number, line.cells[0]!.col, "syntax.duplicate-key", other, {
          hint: "write the page size once, with either `size` or `sheet`",
          related: [src.span(sizeAt.line, sizeAt.col)],
        });
        continue;
      }
      const parts = line.cells.slice(1);
      if (parts.length !== 1) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", `the page-size scalar is one cell: ${key} ${tupleShapeText(SIZE)}`);
        continue;
      }
      const size = readTupleCells(parts[0]!, SIZE, file, line.number, (diagnostic) => collector.diagnostics.push(diagnostic));
      if (size === null) continue;
      const width = parseGridNm(size[0]!, file, line.number, collector);
      const height = parseGridNm(size[1]!, file, line.number, collector);
      if (width === null || height === null) continue;
      if (width <= 0 || height <= 0) {
        collector.error(file, line.number, parts[0]!.col, "value.length-invalid", "the sheet must be larger than zero");
        continue;
      }
      sheetWidth = width;
      sheetHeight = height;
      sizeAt = { key, line: line.number, col: line.cells[0]!.col };
      continue;
    }

    const cells = line.cells;
    switch (section) {
      case "junction": {
        const item = parseJunctionRow(cells, line.number, ctx);
        if (item !== null) {
          junction.push(item);
          at.set(item, line.number);
        }
        continue;
      }
      case "place": {
        const placed = parsePlaceRow(cells, line.number, ctx);
        if (placed !== null) {
          place.push(placed);
          at.set(placed, line.number);
        }
        continue;
      }
      case "field": {
        const written = parseFieldRow(cells, line.number, ctx);
        if (written !== null) {
          fields.push(written);
          at.set(written, line.number);
        }
        continue;
      }
      case "module": {
        // The section header already reported a file that is too old for this section.
        if (!moduleSyntax) continue;
        if (cells.length < 4) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a module row needs 4 columns: module_instance_id module_id ${tupleShapeText(POINT)} ${tupleShapeText(SIZE)}`);
          continue;
        }
        if (cells.length > 4) {
          collector.error(file, line.number, cells[3]!.col, "syntax.column-count", `a module row has exactly 4 columns: module_instance_id module_id ${tupleShapeText(POINT)} ${tupleShapeText(SIZE)}`);
          continue;
        }
        const instanceId = cells[0]!.text;
        if (!MODULE_INSTANCE_ID_RE.test(instanceId)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid module instance id: ${instanceId}`);
          continue;
        }
        const moduleId = cells[1]!.text;
        if (!MODULE_ID_RE.test(moduleId)) {
          collector.error(file, line.number, cells[1]!.col, "syntax.invalid-token", `not a valid module id: ${moduleId}`);
          continue;
        }
        const point = parsePointCell(cells[2]!, file, line.number, collector);
        if (point === null) continue;
        const size = parseSizeCell(cells[3]!, file, line.number, collector);
        if (size === null) continue;
        if (size.width_nm <= 0 || size.height_nm <= 0) {
          collector.error(file, line.number, cells[3]!.col, "value.length-invalid", "the module box must be larger than zero");
          continue;
        }
        const previous = moduleAt.get(instanceId);
        if (previous !== undefined) {
          collector.error(file, line.number, cells[0]!.col, "value.duplicate-id", `duplicate module instance id ${instanceId}`, {
            related: [src.span(previous.line, previous.col)],
          });
          continue;
        }
        moduleAt.set(instanceId, { line: line.number, col: cells[0]!.col });
        const drawn = { instance_id: instanceId, module_id: moduleId, ...point, ...size };
        modules.push(drawn);
        at.set(drawn, line.number);
        continue;
      }
      case "module_port": {
        if (!moduleSyntax) continue;
        if (cells.length < 2) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a module_port row needs 2 columns: module_instance_id.port_id ${tupleShapeText(POINT)}`);
          continue;
        }
        if (cells.length > 2) {
          collector.error(file, line.number, cells[2]!.col, "syntax.column-count", `a module_port row has exactly 2 columns: module_instance_id.port_id ${tupleShapeText(POINT)}`);
          continue;
        }
        const id = cells[0]!.text;
        if (!MODULE_PORT_REF_RE.test(id)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid module port id: ${id}`);
          continue;
        }
        const point = parsePointCell(cells[1]!, file, line.number, collector);
        if (point === null) continue;
        const previous = modulePortAt.get(id);
        if (previous !== undefined) {
          collector.error(file, line.number, cells[0]!.col, "value.duplicate-id", `duplicate module port id ${id}`, {
            related: [src.span(previous.line, previous.col)],
          });
          continue;
        }
        modulePortAt.set(id, { line: line.number, col: cells[0]!.col });
        const drawn = { id, ...point };
        modulePorts.push(drawn);
        at.set(drawn, line.number);
        continue;
      }
      case "interconnect": {
        const drawn = parseInterconnectRow(cells, line.number, ctx);
        if (drawn !== null) {
          const previous = interconnectAt.get(drawn.id);
          if (previous !== undefined) {
            collector.error(file, line.number, cells[0]!.col, "value.duplicate-id", `duplicate interconnect id ${drawn.id}`, {
              related: [src.span(previous.line, previous.col)],
            });
            continue;
          }
          interconnectAt.set(drawn.id, { line: line.number, col: cells[0]!.col });
          interconnects.push(drawn);
          at.set(drawn, line.number);
        }
        continue;
      }


      case "module_place": {
        // The section header already reported a file that is too old for this section.
        if (!compositionSyntax) continue;
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a module_place row needs 3 columns: module_instance_id module_id ${tupleShapeText(POINT)} [<rot>]`);
          continue;
        }
        if (cells.length > 4) {
          collector.error(file, line.number, cells[3]!.col, "syntax.column-count", `a module_place row has at most 4 columns: module_instance_id module_id ${tupleShapeText(POINT)} [<rot>]`);
          continue;
        }
        const instanceId = cells[0]!.text;
        if (!MODULE_INSTANCE_ID_RE.test(instanceId)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid module instance id: ${instanceId}`);
          continue;
        }
        const moduleId = cells[1]!.text;
        if (!MODULE_ID_RE.test(moduleId)) {
          collector.error(file, line.number, cells[1]!.col, "syntax.invalid-token", `not a valid module id: ${moduleId}`);
          continue;
        }
        const point = parsePointCell(cells[2]!, file, line.number, collector);
        if (point === null) continue;
        let rot: 0 | 90000 | 180000 | 270000 | undefined;
        if (cells.length > 3) {
          const parsed = parsePlacementRotation(cells[3]!, file, line.number, collector);
          if (parsed === null) continue;
          // A zero rotation is the default: the IR omits it, so `0` and "no rot" are the same file.
          rot = parsed === 0 ? undefined : parsed;
        }
        // The same drawing may be placed more than once (ADR-0068 D4): a placement is identified by
        // its instance and its position, so only the same instance at the same position is a repeat.
        const placementKey = `${instanceId}@${point.x_nm},${point.y_nm}`;
        const previous = modulePlaceAt.get(placementKey);
        if (previous !== undefined) {
          collector.error(file, line.number, cells[0]!.col, "value.duplicate-id", `duplicate module placement: ${instanceId} at the same position`, {
            related: [src.span(previous.line, previous.col)],
          });
          continue;
        }
        modulePlaceAt.set(placementKey, { line: line.number, col: cells[0]!.col });
        const drawn = { instance_id: instanceId, module_id: moduleId, ...point, ...(rot === undefined ? {} : { rot_mdeg: rot }) };
        modulePlaces.push(drawn);
        at.set(drawn, line.number);
        continue;
      }
      case "wire": {
        const drawn = parseWireRow(cells, line.number, ctx);
        if (drawn !== null) {
          wire.push(drawn);
          at.set(drawn, line.number);
        }
        continue;
      }
      case "label": {
        const named = parseLabelRow(cells, line.number, ctx);
        if (named !== null) {
          label.push(named);
          at.set(named, line.number);
        }
        continue;
      }
      case "port": {
        const printed = parsePortRow(cells, line.number, ctx);
        if (printed !== null) {
          port.push(printed);
          at.set(printed, line.number);
        }
        continue;
      }
      case "text": {
        const written = parseTextRow(cells, line, line.number, ctx);
        if (written !== null) {
          texts.push(written);
          at.set(written, line.number);
        }
        continue;
      }
    }
  }

  // Cross-check the named endpoints available on this page.
  checkDrawing(
    { place, field: fields, junction, wire, label, port, text: texts },
    ctx,
    // A page with a template takes its extent from the template (ADR-0068 D4).
    template === null ? { width_nm: sheetWidth, height_nm: sheetHeight } : null,
    modules,
    modulePorts,
  );

  // A page draws its modules one way or the other (ADR-0068 D4): the legacy overview boxes or the
  // placed module drawings, never both.
  if (modulePlaces.length > 0 && (modules.length > 0 || modulePorts.length > 0)) {
    const legacy = modules.length > 0 ? "module" : "module_port";
    collector.error(
      file,
      at.get(modulePlaces[0]!) ?? 1,
      1,
      "syntax.duplicate-key",
      `a page cannot mix the ${legacy} section with the module_place section`,
      {
        hint: "draw the modules of this page one way: either the overview boxes or the placed module drawings",
      },
    );
  }

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  // The IR depends on the drawing only, not on where the rows were written: canonical order per
  // spec/schematic-view.md §11 (wire points keep their order — that one is semantic).
  place.sort((a, b) => naturalCompare(a.instance_id, b.instance_id));
  fields.sort((a, b) => naturalCompare(a.instance_id, b.instance_id) || byteCompare(a.name, b.name));
  modules.sort((a, b) => naturalCompare(a.instance_id, b.instance_id));
  modulePorts.sort((a, b) => naturalCompare(a.id, b.id));
  interconnects.sort((a, b) => naturalCompare(a.id, b.id));
  // The canonical order of a placement list: by instance, then by position (IR v0.19).
  modulePlaces.sort(
    (a, b) =>
      naturalCompare(a.instance_id, b.instance_id) || a.x_nm - b.x_nm || a.y_nm - b.y_nm,
  );
  junction.sort((a, b) => naturalCompare(a.id, b.id));

  wire.sort((a, b) => byteCompare(a.net, b.net) || pinRefCompare(a.from_pin, b.from_pin) || pinRefCompare(a.to_pin, b.to_pin));
  label.sort((a, b) => byteCompare(a.net, b.net) || a.x_nm - b.x_nm || a.y_nm - b.y_nm);
  port.sort((a, b) => byteCompare(a.id, b.id));
  texts.sort((a, b) => a.x_nm - b.x_nm || a.y_nm - b.y_nm || byteCompare(a.text, b.text));

  const ir: SchematicView = {
    ir_version: irVersion,
    // The canonical spelling of the version: `0.7` and `0.7.0` are the same version, so the IR stores one of them.
    format: verdict.ok ? verdict.text : version,
    source: { file: options.file, line: 1 },
    project: "main",
    page,
    // A page with a template carries no sheet: the template's size is the page's extent
    // (ADR-0068 D4). A page without one always carries its effective size.
    ...(template === null ? { sheet: { width_nm: sheetWidth, height_nm: sheetHeight } } : {}),
    ...(template === null ? {} : { template }),
    ...(place.length > 0 ? { place } : {}),
    ...(fields.length > 0 ? { field: fields } : {}),
    ...(modules.length > 0 ? { module: modules } : {}),
    ...(modulePorts.length > 0 ? { module_port: modulePorts } : {}),
    ...(interconnects.length > 0 ? { interconnect: interconnects } : {}),
    ...(modulePlaces.length > 0 ? { module_place: modulePlaces } : {}),
    ...(junction.length > 0 ? { junction } : {}),
    ...(wire.length > 0 ? { wire } : {}),
    ...(label.length > 0 ? { label } : {}),
    ...(port.length > 0 ? { port } : {}),
    ...(texts.length > 0 ? { text: texts } : {}),
  };
  // IR path → span, read off the sorted arrays: the pointer names a position in the shard, and the
  // record at that position is the one whose span goes there (ADR-0004 D2/D4).
  const sources: SourceMap = new Map();
  const note = (base: string, items: readonly object[]): void => {
    items.forEach((item, index) => sources.set(`${base}/${index}`, src.span(at.get(item) ?? 1)));
  };
  if (place.length > 0) note("/place", place);
  note("/field", fields);
  note("/module", modules);
  note("/module_port", modulePorts);
  note("/interconnect", interconnects);
  note("/module_place", modulePlaces);
  note("/wire", wire);
  note("/label", label);
  note("/junction", junction);
  note("/port", port);
  note("/text", texts);
  if (templateAt !== null) sources.set("/template", src.span(templateAt.line, templateAt.col));
  else sources.set("/sheet", src.span(1));

  return { ok: true, ir, diagnostics: collector.diagnostics, sources };
}

export interface ModuleViewParseOptions {
  /** File name, used for diagnostics. */
  file: string;
}

export interface ModuleViewParseResult {
  ok: boolean;
  ir?: ModuleView;
  diagnostics: Diagnostic[];
  /** IR path → span of the record that produced it (ADR-0004 D2). Never persisted. */
  sources?: SourceMap;
}

export interface SheetTemplateParseOptions {
  /** File name, used for diagnostics. */
  file: string;
}

export interface SheetTemplateParseResult {
  ok: boolean;
  ir?: SheetTemplate;
  diagnostics: Diagnostic[];
  /** IR path → span of the record that produced it (ADR-0004 D2). Never persisted. */
  sources?: SourceMap;
}

/** The sections a module drawing writes. */
const MODULE_VIEW_SECTION_SET = new Set<string>(MODULE_VIEW_SECTIONS);
/** The sections a sheet template writes. */
const SHEET_TEMPLATE_SECTION_SET = new Set<string>(SHEET_TEMPLATE_SECTIONS);

/**
 * Parse a `module_view` description: the reusable drawing of one module definition (ADR-0068 D2).
 *
 * The drawing speaks the module's own identities — `U1`, `VCC`, `SYS_OUT` — and has its own bounds,
 * so it can be checked and previewed without a board. It carries no electrical fact: a wire names a
 * net of the module definition, never a board net.
 */
export function parseModuleView(text: string, options: ModuleViewParseOptions): ModuleViewParseResult {
  const collector = new Collector();
  const { file } = options;
  const lexed = lex(text);
  const src = new SourceFile(file, lexed);
  const lines = lexed;
  /**
   * Line of each record, by object identity. A line number is a function of the line order, so it
   * cannot enter the IR (ADR-0004 D1); it is kept beside it for this parse only.
   */
  const at = new Map<object, number>();

  let index = 0;
  const nextMeaningful = (): Line | null => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = nextMeaningful();
  if (!versionLine || versionLine.cells.length !== 2 || versionLine.cells[0]!.text !== "version") {
    collector.error(file, versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const version = versionLine.cells[1]!.text;
  const verdict = checkVersion(version, MODULE_VIEW_RANGE, "module_view");
  if (!verdict.ok) {
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message, {
      ...(verdict.hint === undefined ? {} : { hint: verdict.hint }),
    });
    return { ok: false, diagnostics: collector.diagnostics };
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "module_view") {
    collector.error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be module_view <module_id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const moduleId = typeLine.cells[1]!.text;
  if (!MODULE_ID_RE.test(moduleId)) {
    collector.error(file, typeLine.number, typeLine.cells[1]!.col, "syntax.invalid-token", `not a valid module id: ${moduleId}`);
  }

  let section: (typeof MODULE_VIEW_SECTIONS)[number] | null = null;
  /** The drawing's own extent: the local origin is its upper-left corner. */
  let boundsWidth = 0;
  let boundsHeight = 0;
  let boundsAt: { line: number; col: number } | null = null;
  const rows: DrawingRows = {
    place: [],
    field: [],
    junction: [],
    wire: [],
    label: [],
    port: [],
    text: [],
  };
  /** The shared row parsers work on this: the file, the diagnostics and the module-local dialect. */
  const ctx: RowContext = {
    file,
    collector,
    src,
    dialect: MODULE_DIALECT,
    // A module drawing has no module instances: a wire may not end at a module port here.
    modulePortEndpoints: false,
    junctionAt: new Map<string, { line: number; col: number }>(),
    fieldAt: new Map<string, { line: number; col: number }>(),
    at,
  };

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1 && MODULE_VIEW_SECTION_SET.has(line.cells[0]!.text)) {
      section = line.cells[0]!.text as (typeof MODULE_VIEW_SECTIONS)[number];
      continue;
    }

    if (section === null) {
      // The only scalar: the drawing's own bounds, `bounds [w,h]` (ADR-0068 D2).
      const key = line.cells[0]!.text;
      if (key !== "bounds") {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${key}`);
        continue;
      }
      if (boundsAt !== null) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.duplicate-key", `duplicate bounds key: ${key}`, {
          related: [src.span(boundsAt.line, boundsAt.col)],
        });
        continue;
      }
      const parts = line.cells.slice(1);
      if (parts.length !== 1) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", `the bounds scalar is one cell: ${key} ${tupleShapeText(SIZE)}`);
        continue;
      }
      const size = readTupleCells(parts[0]!, SIZE, file, line.number, (diagnostic) => collector.diagnostics.push(diagnostic));
      if (size === null) continue;
      const width = parseGridNm(size[0]!, file, line.number, collector);
      const height = parseGridNm(size[1]!, file, line.number, collector);
      if (width === null || height === null) continue;
      if (width <= 0 || height <= 0) {
        collector.error(file, line.number, parts[0]!.col, "value.length-invalid", "the bounds must be larger than zero");
        continue;
      }
      boundsWidth = width;
      boundsHeight = height;
      boundsAt = { line: line.number, col: line.cells[0]!.col };
      continue;
    }

    const cells = line.cells;
    switch (section) {
      case "place": {
        const placed = parsePlaceRow(cells, line.number, ctx);
        if (placed !== null) {
          rows.place.push(placed);
          at.set(placed, line.number);
        }
        continue;
      }
      case "field": {
        const written = parseFieldRow(cells, line.number, ctx);
        if (written !== null) {
          rows.field.push(written);
          at.set(written, line.number);
        }
        continue;
      }
      case "junction": {
        const item = parseJunctionRow(cells, line.number, ctx);
        if (item !== null) {
          rows.junction.push(item);
          at.set(item, line.number);
        }
        continue;
      }
      case "wire": {
        const drawn = parseWireRow(cells, line.number, ctx);
        if (drawn !== null) {
          rows.wire.push(drawn);
          at.set(drawn, line.number);
        }
        continue;
      }
      case "label": {
        const named = parseLabelRow(cells, line.number, ctx);
        if (named !== null) {
          rows.label.push(named);
          at.set(named, line.number);
        }
        continue;
      }
      case "port": {
        const printed = parsePortRow(cells, line.number, ctx);
        if (printed !== null) {
          rows.port.push(printed);
          at.set(printed, line.number);
        }
        continue;
      }
      case "text": {
        const written = parseTextRow(cells, line, line.number, ctx);
        if (written !== null) {
          rows.text.push(written);
          at.set(written, line.number);
        }
        continue;
      }
    }
  }

  if (boundsAt === null) {
    collector.error(file, 1, 1, "syntax.unknown-field", "missing required scalar: bounds [w,h]", {
      expected: "bounds [w,h]",
      hint: "a module drawing has its own extent: the local origin is its upper-left corner",
    });
  }

  // The geometry has to fit the drawing's own bounds. A drawing without bounds has no extent to
  // check against; the missing scalar is already reported.
  checkDrawing(
    rows,
    ctx,
    boundsAt === null ? null : { width_nm: boundsWidth, height_nm: boundsHeight },
    [],
    [],
    "the module drawing's bounds",
  );

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  // The IR depends on the drawing only, not on where the rows were written.
  rows.place.sort((a, b) => naturalCompare(a.instance_id, b.instance_id));
  rows.field.sort((a, b) => naturalCompare(a.instance_id, b.instance_id) || byteCompare(a.name, b.name));
  rows.junction.sort((a, b) => naturalCompare(a.id, b.id));
  rows.wire.sort((a, b) => byteCompare(a.net, b.net) || pinRefCompare(a.from_pin, b.from_pin) || pinRefCompare(a.to_pin, b.to_pin));
  rows.label.sort((a, b) => byteCompare(a.net, b.net) || a.x_nm - b.x_nm || a.y_nm - b.y_nm);
  rows.port.sort((a, b) => byteCompare(a.id, b.id));
  rows.text.sort((a, b) => a.x_nm - b.x_nm || a.y_nm - b.y_nm || byteCompare(a.text, b.text));

  const ir: ModuleView = {
    ir_version: irVersion,
    // The canonical spelling of the version: `0.13` and `0.13.0` are the same version.
    format: verdict.ok ? verdict.text : version,
    source: { file: options.file, line: 1 },
    module_id: moduleId,
    bounds: { width_nm: boundsWidth, height_nm: boundsHeight },
    place: rows.place,
    ...(rows.field.length > 0 ? { field: rows.field } : {}),
    ...(rows.junction.length > 0 ? { junction: rows.junction } : {}),
    ...(rows.wire.length > 0 ? { wire: rows.wire } : {}),
    ...(rows.label.length > 0 ? { label: rows.label } : {}),
    ...(rows.port.length > 0 ? { port: rows.port } : {}),
    ...(rows.text.length > 0 ? { text: rows.text } : {}),
  };
  const sources: SourceMap = new Map();
  const note = (base: string, items: readonly object[]): void => {
    items.forEach((item, index) => sources.set(`${base}/${index}`, src.span(at.get(item) ?? 1)));
  };
  note("/place", rows.place);
  note("/field", rows.field);
  note("/junction", rows.junction);
  note("/wire", rows.wire);
  note("/label", rows.label);
  note("/port", rows.port);
  note("/text", rows.text);
  sources.set("/bounds", src.span(boundsAt?.line ?? 1, boundsAt?.col ?? 1));

  return { ok: true, ir, diagnostics: collector.diagnostics, sources };
}

/**
 * Parse a `sheet_template` description: the static furniture of a page (ADR-0068 D3).
 *
 * A template is literal: it draws lines, rectangles, polylines and text, and it says nothing about
 * the board. Every row carries its own id, and every coordinate has to fit the template's size.
 */
export function parseSheetTemplate(text: string, options: SheetTemplateParseOptions): SheetTemplateParseResult {
  const collector = new Collector();
  const { file } = options;
  const lexed = lex(text);
  const src = new SourceFile(file, lexed);
  const lines = lexed;
  const at = new Map<object, number>();

  let index = 0;
  const nextMeaningful = (): Line | null => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = nextMeaningful();
  if (!versionLine || versionLine.cells.length !== 2 || versionLine.cells[0]!.text !== "version") {
    collector.error(file, versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const version = versionLine.cells[1]!.text;
  const verdict = checkVersion(version, SHEET_TEMPLATE_RANGE, "sheet_template");
  if (!verdict.ok) {
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message, {
      ...(verdict.hint === undefined ? {} : { hint: verdict.hint }),
    });
    return { ok: false, diagnostics: collector.diagnostics };
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "sheet_template") {
    collector.error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be sheet_template <template_id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const templateId = typeLine.cells[1]!.text;
  if (!TEMPLATE_ID_RE.test(templateId)) {
    collector.error(file, typeLine.number, typeLine.cells[1]!.col, "syntax.invalid-token", `not a valid template id: ${templateId}`);
  }

  let section: (typeof SHEET_TEMPLATE_SECTIONS)[number] | null = null;
  /** The size of the template: the page extent it gives to the pages that use it. */
  let sizeWidth = 0;
  let sizeHeight = 0;
  let sizeAt: { line: number; col: number } | null = null;
  /** Every furniture row carries an id, and the ids are unique in the template. */
  const idsAt = new Map<string, { line: number; col: number }>();
  const lineRows: NonNullable<SheetTemplate["line"]> = [];
  const rects: NonNullable<SheetTemplate["rect"]> = [];
  const polylines: NonNullable<SheetTemplate["polyline"]> = [];
  const texts: NonNullable<SheetTemplate["text"]> = [];

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1 && SHEET_TEMPLATE_SECTION_SET.has(line.cells[0]!.text)) {
      section = line.cells[0]!.text as (typeof SHEET_TEMPLATE_SECTIONS)[number];
      continue;
    }

    if (section === null) {
      // The only scalar: the template's size, `size [w,h]` (ADR-0068 D3).
      const key = line.cells[0]!.text;
      if (key !== "size") {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${key}`);
        continue;
      }
      if (sizeAt !== null) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.duplicate-key", `duplicate size key: ${key}`, {
          related: [src.span(sizeAt.line, sizeAt.col)],
        });
        continue;
      }
      const parts = line.cells.slice(1);
      if (parts.length !== 1) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", `the size scalar is one cell: ${key} ${tupleShapeText(SIZE)}`);
        continue;
      }
      const size = readTupleCells(parts[0]!, SIZE, file, line.number, (diagnostic) => collector.diagnostics.push(diagnostic));
      if (size === null) continue;
      const width = parseGridNm(size[0]!, file, line.number, collector);
      const height = parseGridNm(size[1]!, file, line.number, collector);
      if (width === null || height === null) continue;
      if (width <= 0 || height <= 0) {
        collector.error(file, line.number, parts[0]!.col, "value.length-invalid", "the template size must be larger than zero");
        continue;
      }
      sizeWidth = width;
      sizeHeight = height;
      sizeAt = { line: line.number, col: line.cells[0]!.col };
      continue;
    }

    const cells = line.cells;
    const id = cells[0]!.text;
    if (!FURNITURE_ID_RE.test(id)) {
      collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid furniture id: ${id}`);
      continue;
    }
    const previous = idsAt.get(id);
    if (previous !== undefined) {
      collector.error(file, line.number, cells[0]!.col, "value.duplicate-id", `duplicate furniture id ${id}`, {
        related: [src.span(previous.line, previous.col)],
      });
      continue;
    }

    switch (section) {
      case "line": {
        if (cells.length !== 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a line row has exactly 3 columns: id ${tupleShapeText(POINT)} ${tupleShapeText(POINT)}`);
          continue;
        }
        const start = parsePointCell(cells[1]!, file, line.number, collector);
        if (start === null) continue;
        const end = parsePointCell(cells[2]!, file, line.number, collector);
        if (end === null) continue;
        const drawn: NonNullable<SheetTemplate["line"]>[number] = { id, start, end };
        idsAt.set(id, { line: line.number, col: cells[0]!.col });
        lineRows.push(drawn);
        at.set(drawn, line.number);
        continue;
      }
      case "rect": {
        if (cells.length !== 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a rect row has exactly 3 columns: id ${tupleShapeText(POINT)} ${tupleShapeText(POINT)}`);
          continue;
        }
        const start = parsePointCell(cells[1]!, file, line.number, collector);
        if (start === null) continue;
        const end = parsePointCell(cells[2]!, file, line.number, collector);
        if (end === null) continue;
        const drawn: NonNullable<SheetTemplate["rect"]>[number] = { id, start, end };
        idsAt.set(id, { line: line.number, col: cells[0]!.col });
        rects.push(drawn);
        at.set(drawn, line.number);
        continue;
      }
      case "polyline": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a polyline row needs at least 3 columns: id ${tupleShapeText(POINT)} ${tupleShapeText(POINT)}`);
          continue;
        }
        const points: Array<NonNullable<SheetTemplate["polyline"]>[number]["points"][number]> = [];
        for (const cell of cells.slice(1)) {
          const point = parsePointCell(cell, file, line.number, collector);
          if (point === null) {
            points.length = 0;
            break;
          }
          points.push(point);
        }
        if (points.length < 2) continue;
        const [first, second, ...rest] = points;
        const drawn: NonNullable<SheetTemplate["polyline"]>[number] = { id, points: [first!, second!, ...rest] };
        idsAt.set(id, { line: line.number, col: cells[0]!.col });
        polylines.push(drawn);
        at.set(drawn, line.number);
        continue;
      }
      case "text": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", `a text row needs 3 columns: id ${tupleShapeText(POINT)} text`);
          continue;
        }
        const point = parsePointCell(cells[1]!, file, line.number, collector);
        if (point === null) continue;
        const body = restOfLine(line, 2);
        if (body.length === 0) {
          collector.error(file, line.number, cells[2]!.col, "syntax.row-too-short", "a text row needs some text");
          continue;
        }
        const written: NonNullable<SheetTemplate["text"]>[number] = { id, ...point, text: body };
        idsAt.set(id, { line: line.number, col: cells[0]!.col });
        texts.push(written);
        at.set(written, line.number);
        continue;
      }
    }
  }

  if (sizeAt === null) {
    collector.error(file, 1, 1, "syntax.unknown-field", "missing required scalar: size [w,h]", {
      expected: "size [w,h]",
      hint: "the template's size is the extent of every page that uses it",
    });
  }

  // Every piece of furniture has to fit the template's own size. A template without a size has no
  // extent to check against; the missing scalar is already reported.
  if (sizeAt !== null) {
    for (const item of lineRows) {
      for (const point of [item.start, item.end]) {
        checkOnSheet(file, at.get(item) ?? 1, point.x_nm, point.y_nm, sizeWidth, sizeHeight, collector, "the template size");
      }
    }
    for (const item of rects) {
      for (const point of [item.start, item.end]) {
        checkOnSheet(file, at.get(item) ?? 1, point.x_nm, point.y_nm, sizeWidth, sizeHeight, collector, "the template size");
      }
    }
    for (const item of polylines) {
      for (const point of item.points) {
        checkOnSheet(file, at.get(item) ?? 1, point.x_nm, point.y_nm, sizeWidth, sizeHeight, collector, "the template size");
      }
    }
    for (const item of texts) {
      checkOnSheet(file, at.get(item) ?? 1, item.x_nm, item.y_nm, sizeWidth, sizeHeight, collector, "the template size");
    }
  }

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  // The IR depends on the furniture only, not on where the rows were written.
  lineRows.sort((a, b) => byteCompare(a.id, b.id));
  rects.sort((a, b) => byteCompare(a.id, b.id));
  polylines.sort((a, b) => byteCompare(a.id, b.id));
  texts.sort((a, b) => byteCompare(a.id, b.id));

  const ir: SheetTemplate = {
    ir_version: irVersion,
    // The canonical spelling of the version: `0.13` and `0.13.0` are the same version.
    format: verdict.ok ? verdict.text : version,
    source: { file: options.file, line: 1 },
    template_id: templateId,
    size: { width_nm: sizeWidth, height_nm: sizeHeight },
    ...(lineRows.length > 0 ? { line: lineRows } : {}),
    ...(rects.length > 0 ? { rect: rects } : {}),
    ...(polylines.length > 0 ? { polyline: polylines } : {}),
    ...(texts.length > 0 ? { text: texts } : {}),
  };
  const sources: SourceMap = new Map();
  const note = (base: string, items: readonly object[]): void => {
    items.forEach((item, index) => sources.set(`${base}/${index}`, src.span(at.get(item) ?? 1)));
  };
  note("/line", lineRows);
  note("/rect", rects);
  note("/polyline", polylines);
  note("/text", texts);
  sources.set("/size", src.span(sizeAt?.line ?? 1, sizeAt?.col ?? 1));

  return { ok: true, ir, diagnostics: collector.diagnostics, sources };
}

/** A coordinate outside the sheet is a drawing that cannot be shown. */
function checkOnSheet(
  file: string,
  line: number,
  x: number,
  y: number,
  width: number,
  height: number,
  collector: Collector,
  /** What the extent is called: a page's sheet, a module drawing's bounds, a template's size. */
  extent = "the sheet",
): void {
  if (x < 0 || y < 0 || x > width || y > height) {
    collector.error(
      file,
      line,
      1,
      "view.out-of-sheet",
      `the coordinate (${x / 1_000_000}mm, ${y / 1_000_000}mm) is outside ${extent} (${width / 1_000_000}mm x ${height / 1_000_000}mm)`,
    );
  }
}

/**
 * A module box has to fit on the page: the box is drawn on this page, so its whole extent lies
 * inside the page's own size (spec/schematic-view.md §2.1, §4.2).
 */
function checkBoxOnSheet(
  file: string,
  line: number,
  x: number,
  y: number,
  width: number,
  height: number,
  sheetWidth: number,
  sheetHeight: number,
  collector: Collector,
  /** What the extent is called: a page's sheet, a module drawing's bounds. */
  extent = "the sheet",
): void {
  if (x < 0 || y < 0 || x + width > sheetWidth || y + height > sheetHeight) {
    collector.error(
      file,
      line,
      1,
      "view.out-of-sheet",
      `the module box at (${x / 1_000_000}mm, ${y / 1_000_000}mm) of ${width / 1_000_000}mm x ${height / 1_000_000}mm does not fit ${extent} (${sheetWidth / 1_000_000}mm x ${sheetHeight / 1_000_000}mm)`,
    );
  }
}
