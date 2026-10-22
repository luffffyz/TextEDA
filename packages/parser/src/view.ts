// `view` description parsing: `.teda` source → the S1 view IR (spec/schematic-view.md, ADR-0021, ADR-0025).
//
// The view is the drawing layer: it says where the symbols sit and how the wires run, and it
// references the board's instances / nets / ports by their board-level names. It restates no electrical
// fact and it never changes connectivity (spec/schematic-view.md §0).
//
// What is checked here is what the file can know by itself: the syntax, the right-angle rule, the
// sheet bounds, and "the endpoint's instance is placed". Everything that needs the board (does this net
// exist? is this pin one of its members?) is the board cross-check's job, not the parser's.
import { irVersion } from "@texteda/ir";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex, type Cell, type Line } from "./lexer.ts";
import { parseAngleMdeg, parseLengthNm } from "./units.ts";
import { checkVersion, typeRange } from "./version.ts";

export const VIEW_SECTIONS = ["place", "wire", "label", "port", "text"] as const;
export type ViewSection = (typeof VIEW_SECTIONS)[number];

const SECTION_SET = new Set<string>(VIEW_SECTIONS);
/** The `place` tail keys (the section is a table with an optional key=value tail). */
const PLACE_KEYS = new Set(["unit"]);
const VIEW_ID_RE = /^[A-Za-z0-9_+-]+$/;
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
 * `view` was introduced in language version 0.6 (teda.md §13); since 0.7 it names board-level ids
 * (ADR-0025), so a 0.6 view file is no longer accepted.
 */
const VERSION_RANGE = typeRange(7);
/** A4 landscape, in nanometers. */
export const DEFAULT_SHEET_WIDTH_NM = 297_000_000;
export const DEFAULT_SHEET_HEIGHT_NM = 210_000_000;
/** The view's coordinates are kept on a 0.1 mm grid, so the canonical form is lossless. */
export const VIEW_GRID_NM = 100_000;
/** v0.1 supports right angles only. */
const RIGHT_ANGLE_MDEG = 90_000;

export interface ViewParseOptions {
  /** File name, used for diagnostics. */
  file: string;
  /** board_id; resolved from the directory `sch/<board_id>/`, not written in the file. */
  board: string;
}

export interface ViewParseResult {
  ok: boolean;
  ir?: SchematicView;
  diagnostics: Diagnostic[];
}

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  error(file: string, line: number, col: number, code: DiagnosticCodeId, message: string): void {
    this.diagnostics.push({ code, severity: "error", message, location: { file, line, col } });
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

/** A length on the 0.1 mm grid; the canonical form prints it back without losing information. */
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
    collector.error(file, line, cell.col, "value.length-invalid", `coordinates are limited to 0.1 mm resolution: ${cell.text}`);
    return null;
  }
  return parsed.value;
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
 * Parse a `view` description.
 *
 * The print page id comes from the type line (`view <page_id>`); the board id comes from the directory
 * `sch/<board_id>/` and is passed in by the caller.
 */
export function parseView(text: string, options: ViewParseOptions): ViewParseResult {
  const collector = new Collector();
  const { file } = options;
  const lines = lex(text);

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
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message);
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

  let section: ViewSection | null = null;
  let sheetWidth = DEFAULT_SHEET_WIDTH_NM;
  let sheetHeight = DEFAULT_SHEET_HEIGHT_NM;
  const place: SchematicView["place"] = [];
  const wire: SchematicView["wire"] = [];
  const label: SchematicView["label"] = [];
  const port: SchematicView["port"] = [];
  const texts: SchematicView["text"] = [];

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1 && SECTION_SET.has(line.cells[0]!.text)) {
      section = line.cells[0]!.text as ViewSection;
      continue;
    }

    if (section === null) {
      // A scalar: `sheet <width> <height>`.
      const key = line.cells[0]!.text;
      if (key !== "sheet") {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${key}`);
        continue;
      }
      const parts = line.cells.slice(1);
      if (parts.length !== 2) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", "the sheet scalar needs two values: <width> <height>");
        continue;
      }
      const width = parseGridNm(parts[0]!, file, line.number, collector);
      const height = parseGridNm(parts[1]!, file, line.number, collector);
      if (width === null || height === null) continue;
      if (width <= 0 || height <= 0) {
        collector.error(file, line.number, parts[0]!.col, "value.length-invalid", "the sheet must be larger than zero");
        continue;
      }
      sheetWidth = width;
      sheetHeight = height;
      continue;
    }

    const cells = line.cells;
    switch (section) {
      case "place": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", "a place row needs at least 3 columns: instance_id x y");
          continue;
        }
        const instanceId = cells[0]!.text;
        if (!INSTANCE_ID_RE.test(instanceId)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid instance id: ${instanceId}`);
          continue;
        }
        const x = parseGridNm(cells[1]!, file, line.number, collector);
        const y = parseGridNm(cells[2]!, file, line.number, collector);
        if (x === null || y === null) continue;
        let rot: number | undefined;
        let unit: number | undefined;
        for (const cell of cells.slice(3)) {
          const eq = cell.text.indexOf("=");
          if (eq <= 0) {
            if (rot === undefined) {
              const parsed = parseRotation(cell, file, line.number, collector);
              if (parsed === null) continue;
              // A zero rotation is the default: the IR omits it, so `0` and "no rot" are the same file.
              rot = parsed === 0 ? undefined : parsed;
              continue;
            }
            collector.error(file, line.number, cell.col, "syntax.invalid-token", `unrecognized cell: ${cell.text}`);
            continue;
          }
          const key = cell.text.slice(0, eq);
          if (!PLACE_KEYS.has(key)) {
            collector.error(file, line.number, cell.col, "syntax.unknown-field", `unknown key: ${key}`);
            continue;
          }
          if (key === "unit") {
            const raw = cell.text.slice(eq + 1);
            if (!/^\d+$/.test(raw) || Number(raw) < 1) {
              collector.error(file, line.number, cell.col, "value.invalid-value", `unit must be a positive integer: ${raw}`);
              continue;
            }
            unit = Number(raw);
            // Unit 1 is the default: the IR omits it, so `unit=1` and "no unit" are the same file.
            if (unit === 1) unit = undefined;
          }
        }
        place.push({ instance_id: instanceId, x_nm: x, y_nm: y, ...(rot === undefined ? {} : { rot_mdeg: rot }), ...(unit === undefined ? {} : { unit }), line: line.number });
        continue;
      }
      case "wire": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", "a wire row needs at least 3 columns: net from_pin to_pin");
          continue;
        }
        const net = cells[0]!.text;
        if (!NET_ID_RE.test(net)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid net id: ${net}`);
          continue;
        }
        const fromPin = cells[1]!.text;
        const toPin = cells[2]!.text;
        if (!PIN_REF_RE.test(fromPin)) {
          collector.error(file, line.number, cells[1]!.col, "syntax.invalid-ref", `not a valid pin reference: ${fromPin}`);
          continue;
        }
        if (!PIN_REF_RE.test(toPin)) {
          collector.error(file, line.number, cells[2]!.col, "syntax.invalid-ref", `not a valid pin reference: ${toPin}`);
          continue;
        }
        const tail = cells.slice(3);
        if (tail.length % 2 !== 0) {
          collector.error(file, line.number, cells[3]!.col, "syntax.row-too-short", "the bend points are coordinate pairs: x y x y");
          continue;
        }
        const points: { x_nm: number; y_nm: number }[] = [];
        let broken = false;
        for (let i = 0; i < tail.length; i += 2) {
          const x = parseGridNm(tail[i]!, file, line.number, collector);
          const y = parseGridNm(tail[i + 1]!, file, line.number, collector);
          if (x === null || y === null) {
            broken = true;
            break;
          }
          points.push({ x_nm: x, y_nm: y });
        }
        if (broken) continue;
        wire.push({ net, from_pin: fromPin, to_pin: toPin, ...(points.length > 0 ? { points } : {}), line: line.number });
        continue;
      }
      case "label": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", "a label row needs 3 columns: net x y");
          continue;
        }
        const net = cells[0]!.text;
        if (!NET_ID_RE.test(net)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid net id: ${net}`);
          continue;
        }
        const x = parseGridNm(cells[1]!, file, line.number, collector);
        const y = parseGridNm(cells[2]!, file, line.number, collector);
        if (x === null || y === null) continue;
        label.push({ net, x_nm: x, y_nm: y, line: line.number });
        continue;
      }
      case "port": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", "a port row needs at least 3 columns: port_id x y");
          continue;
        }
        const id = cells[0]!.text;
        if (!VIEW_ID_RE.test(id)) {
          collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid port id: ${id}`);
          continue;
        }
        const x = parseGridNm(cells[1]!, file, line.number, collector);
        const y = parseGridNm(cells[2]!, file, line.number, collector);
        if (x === null || y === null) continue;
        let rot: number | undefined;
        if (cells.length > 3) {
          const parsed = parseRotation(cells[3]!, file, line.number, collector);
          if (parsed === null) continue;
          rot = parsed === 0 ? undefined : parsed;
        }
        port.push({ id, x_nm: x, y_nm: y, ...(rot === undefined ? {} : { rot_mdeg: rot }), line: line.number });
        continue;
      }
      case "text": {
        if (cells.length < 3) {
          collector.error(file, line.number, cells[0]!.col, "syntax.row-too-short", "a text row needs 3 columns: x y text");
          continue;
        }
        const x = parseGridNm(cells[0]!, file, line.number, collector);
        const y = parseGridNm(cells[1]!, file, line.number, collector);
        if (x === null || y === null) continue;
        const body = restOfLine(line, 2);
        if (body.length === 0) {
          collector.error(file, line.number, cells[2]!.col, "syntax.row-too-short", "a text row needs some text");
          continue;
        }
        texts.push({ x_nm: x, y_nm: y, text: body, line: line.number });
        continue;
      }
    }
  }

  // Cross-checks the file can answer on its own.
  const placed = new Set(place.map((p) => p.instance_id));
  for (const item of wire) {
    for (const ref of [item.from_pin, item.to_pin]) {
      // The instance id may be module-qualified (`M1.U1`), so the split is at the last dot.
      const instanceId = ref.slice(0, ref.lastIndexOf("."));
      if (!placed.has(instanceId)) {
        collector.error(
          file,
          item.line ?? 1,
          1,
          "view.pin-not-placed",
          `the instance ${instanceId} of pin ${ref} is not in the place section`,
        );
      }
    }
  }
  for (const item of place) {
    checkOnSheet(file, item.line ?? 1, item.x_nm, item.y_nm, sheetWidth, sheetHeight, collector);
  }
  for (const item of wire) {
    for (const point of item.points ?? []) {
      checkOnSheet(file, item.line ?? 1, point.x_nm, point.y_nm, sheetWidth, sheetHeight, collector);
    }
  }
  for (const item of label) {
    checkOnSheet(file, item.line ?? 1, item.x_nm, item.y_nm, sheetWidth, sheetHeight, collector);
  }
  for (const item of port) {
    checkOnSheet(file, item.line ?? 1, item.x_nm, item.y_nm, sheetWidth, sheetHeight, collector);
  }
  for (const item of texts) {
    checkOnSheet(file, item.line ?? 1, item.x_nm, item.y_nm, sheetWidth, sheetHeight, collector);
  }

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  const ir: SchematicView = {
    ir_version: irVersion,
    // The canonical spelling of the version: `0.7` and `0.7.0` are the same version, so the IR stores one of them.
    format: verdict.ok ? verdict.text : version,
    source: { file: options.file, line: 1 },
    board: options.board,
    page,
    sheet: { width_nm: sheetWidth, height_nm: sheetHeight },
    place,
    ...(wire.length > 0 ? { wire } : {}),
    ...(label.length > 0 ? { label } : {}),
    ...(port.length > 0 ? { port } : {}),
    ...(texts.length > 0 ? { text: texts } : {}),
  };
  return { ok: true, ir, diagnostics: collector.diagnostics };
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
): void {
  if (x < 0 || y < 0 || x > width || y > height) {
    collector.error(
      file,
      line,
      1,
      "view.out-of-sheet",
      `the coordinate (${x / VIEW_GRID_NM}mm, ${y / VIEW_GRID_NM}mm) is outside the sheet (${width / VIEW_GRID_NM}mm x ${height / VIEW_GRID_NM}mm)`,
    );
  }
}
