// `pcb` description → IR (`schemas/ir/v0.5/pcb.schema.json`). See `spec/pcb.md` for the spec.
//
// This layer only does "text → structure": read sections, validate column counts and enums,
// and replace unit-bearing literals with integers.
// Cross-description consistency (whether a pad belongs to the same sch net, whether a net exists)
// is binding validation (spec §5.2); it needs the flattened sch result and is not done in this file.
import { irVersion } from "@texteda/ir";
import type {
  ConnectEdge,
  Deviation,
  Keepout,
  PhysicalOnly,
  Placement,
  Point,
  Pcb,
  Rule,
  Silk,
  StackupLayer,
  Trace,
  Via,
  Zone,
} from "@texteda/ir/pcb";
import type { Diagnostic, DiagnosticCodeId } from "@texteda/ir/diagnostics";
import { lex, type Cell, type Line } from "./lexer.ts";
import { SourceFile, recordObjects } from "./sources.ts";
import type { SourceMap, Span } from "@texteda/ir/spans";
import { parseAngleMdeg, parseLengthNm } from "./units.ts";
import { checkVersion, typeRange } from "./version.ts";
import { parseQuantity } from "./quantities.ts";
import { byteCompare } from "@texteda/ir/order";

export interface PcbParseOptions {
  file: string;
  board: string;
}

export interface PcbParseResult {
  ok: boolean;
  ir?: Pcb;
  diagnostics: Diagnostic[];
  /** IR path → span of the record that produced it (ADR-0103 D2). Never persisted. */
  sources?: SourceMap;
}

export const PCB_SECTIONS = [
  "stackup",
  "outline",
  "place",
  "connect",
  "trace",
  "via",
  "zone",
  "keepout",
  "rules",
  "silk",
  "physical_only",
  "deviation",
] as const;

type Section = (typeof PCB_SECTIONS)[number];

const SECTION_SET: ReadonlySet<string> = new Set(PCB_SECTIONS);
/**
 * `pcb` was introduced in language version 0.4; since 0.7 its instance ids and net names are the
 * board's own (no page prefix, ADR-0111), so a 0.4 pcb file has to be re-checked.
 */
const VERSION_RANGE = typeRange("pcb");

const SCALARS = new Set(["board_thickness"]);

const KINDS = new Set(["signal", "power", "plane"]);
const SIDES = new Set(["top", "bottom"]);
const KEEPOUT_TYPES = new Set(["no_track", "no_pour", "no_place", "no_via"]);
const SILK_ITEMS = new Set(["refdes", "value"]);
const SILK_LAYERS = new Set(["F.SilkS", "B.SilkS"]);
const SILK_MODES = new Set(["show", "hide"]);
const PHYSICAL_ONLY_TYPES = new Set(["mounting", "fiducial", "stitching", "cutout"]);
const DEVIATION_TYPES = new Set(["net_tie", "split_ground"]);

/** The type order for `rules` (`spec/pcb.md` §6.2): IR and the formatter share the same convention. */
export const RULE_ORDER = ["clearance", "width", "via", "net", "diff", "match", "mask", "paste", "thermal", "min_width"];

/** Rule type → required number of columns (including the type column). */
const RULE_COLUMNS: Record<string, number> = {
  clearance: 2,
  width: 2,
  via: 3,
  net: 6,
  diff: 5,
  match: 4,
  mask: 2,
  paste: 3,
  thermal: 3,
  min_width: 2,
};

/** Copper layer names: `F.Cu` / `In1.Cu` … / `B.Cu`. */
const COPPER_LAYER = /^(F|B|In[1-9]\d*)\.Cu$/;
/** Dielectric layer names: `prepreg` / `core` / `d1`…. */
const DIELECTRIC_LAYER = /^(prepreg|core|d[1-9]\d*)$/;

class Diagnostics {
  readonly items: Diagnostic[] = [];

  add(
    severity: "error" | "warning",
    code: DiagnosticCodeId,
    message: string,
    file: string,
    line: number,
    col: number,
    extra?: {
      expected?: string;
      actual?: string;
      hint?: string;
      data?: Record<string, string | number | boolean>;
    },
  ): void {
    this.items.push({
      code,
      severity,
      message,
      location: { file, line, col },
      ...(extra?.expected === undefined ? {} : { expected: extra.expected }),
      ...(extra?.actual === undefined ? {} : { actual: extra.actual }),
      ...(extra?.hint === undefined ? {} : { hint: extra.hint }),
      ...(extra?.data === undefined ? {} : { data: extra.data }),
    });
  }

  get hasError(): boolean {
    return this.items.some((d) => d.severity === "error");
  }
}

/** Split "data rows of sections" by section: switch sections when a section name appears in the first column. */
interface SectionBlock {
  section: Section;
  header: Line;
  rows: Line[];
}

function splitSections(
  lines: readonly Line[],
  diagnostics: Diagnostics,
  file: string,
): { blocks: SectionBlock[]; scalars: Line[] } {
  const blocks: SectionBlock[] = [];
  const scalars: Line[] = [];
  let current: SectionBlock | undefined;
  /** Unknown section: report the error once and drop the following rows to avoid a cascading error per row. */
  let sinking = false;

  for (const line of lines) {
    const head = line.cells[0]!.text;
    // Indentation does not express hierarchy (AGENTS.md §2 item 6), so a section header is recognized by
    // "the whole line has only one cell":
    // `via` is both a section name and a rule type in rules; rule rows have at least 2 columns.
    if (line.cells.length === 1 && SECTION_SET.has(head)) {
      current = { section: head as Section, header: line, rows: [] };
      blocks.push(current);
      sinking = false;
      continue;
    }
    // A line like `stackup 1.6mm` outside a section is a misspelled section header: a header occupies the whole line.
    if (current === undefined && line.cells.length > 1 && SECTION_SET.has(head)) {
      diagnostics.add(
        "error",
        "syntax.column-count",
        `a section header can only have one cell: ${head}`,
        file,
        line.number,
        line.cells[1]!.col,
        { expected: "1", actual: String(line.cells.length) },
      );
      continue;
    }
    if (SCALARS.has(head)) {
      current = undefined;
      sinking = false;
      scalars.push(line);
      continue;
    }
    if (current === undefined) {
      // Outside any section the first cell can only be a known scalar; everything else is treated as an unknown section (AGENTS.md §2 item 7: errors by default).
      diagnostics.add(
        "error",
        "syntax.unknown-section",
        `unknown section: ${head} (see spec/pcb.md §3 for pcb sections)`,
        file,
        line.number,
        line.cells[0]!.col,
        { expected: PCB_SECTIONS.join(" / "), actual: head },
      );
      sinking = true;
      continue;
    }
    if (sinking) continue;
    current.rows.push(line);
  }
  return { blocks, scalars };
}

/** The column count must be exactly `count`. */
function exactColumns(
  line: Line,
  count: number,
  diagnostics: Diagnostics,
  file: string,
): boolean {
  if (line.cells.length === count) return true;
  diagnostics.add(
    "error",
    line.cells.length < count ? "syntax.row-too-short" : "syntax.column-count",
    `this row needs exactly ${count} columns, got ${line.cells.length}`,
    file,
    line.number,
    line.cells[Math.min(count, line.cells.length - 1)]!.col,
    { expected: String(count), actual: String(line.cells.length) },
  );
  return false;
}

function atLeastColumns(
  line: Line,
  count: number,
  diagnostics: Diagnostics,
  file: string,
  expect: string,
): boolean {
  if (line.cells.length >= count) return true;
  diagnostics.add(
    "error",
    "syntax.row-too-short",
    `this row needs at least ${count} columns: ${expect}`,
    file,
    line.number,
    line.cells[0]!.col,
    { expected: expect, actual: `${line.cells.length} columns` },
  );
  return false;
}

/** On parse failure, record the diagnostic and return 0: report as many errors as possible in one parse instead of stopping at the first. */
function unwrap(parsed: ReturnType<typeof parseLengthNm>, diagnostics: Diagnostics): number {
  if (parsed.ok) return parsed.value;
  if (parsed.diagnostic) diagnostics.items.push(parsed.diagnostic);
  return 0;
}

function length(cell: Cell, line: Line, diagnostics: Diagnostics, file: string): number {
  return unwrap(parseLengthNm(cell.text, file, line.number, cell.col), diagnostics);
}

function angle(cell: Cell, line: Line, diagnostics: Diagnostics, file: string): number {
  return unwrap(parseAngleMdeg(cell.text, file, line.number, cell.col), diagnostics);
}

/**
 * Pure ratio → ppm (`4.3` → 4300000). `parsePpm` is for percent/tolerance semantics (limited to 0…0.5);
 * dielectric constant and solder paste ratio are not that semantics, so convert separately here,
 * entirely with integers, never going through floating point.
 */
function ratioPpm(cell: Cell, line: Line, diagnostics: Diagnostics, file: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(cell.text);
  if (match === null) {
    diagnostics.add(
      "error",
      "value.ratio-invalid",
      `not a valid ratio: ${cell.text}`,
      file,
      line.number,
      cell.col,
      { expected: "a non-negative real number with at most 6 decimal places", actual: cell.text },
    );
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]) * 1_000_000;
  const fraction = Number((match[3] ?? "").padEnd(6, "0"));
  return sign * (whole + fraction);
}

/** Read a run of coordinates (given in pairs) and return a list of points. */
function pointList(
  cells: readonly Cell[],
  line: Line,
  diagnostics: Diagnostics,
  file: string,
  minPoints: number,
): Point[] | undefined {
  if (cells.length % 2 !== 0) {
    diagnostics.add(
      "error",
      "value.invalid-value",
      "coordinates must come in pairs (x y)",
      file,
      line.number,
      cells[cells.length - 1]!.col,
    );
    return undefined;
  }
  const points: Point[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    points.push({
      x_nm: length(cells[i]!, line, diagnostics, file),
      y_nm: length(cells[i + 1]!, line, diagnostics, file),
    });
  }
  if (points.length < minPoints) {
    diagnostics.add(
      "error",
      "value.invalid-value",
      `at least ${minPoints} points are required, got ${points.length}`,
      file,
      line.number,
      cells[0]!.col,
    );
    return undefined;
  }
  return points;
}

/** Normalize a ring: rotate the start to the lexicographically smallest vertex, and make the direction uniform so the signed area is positive (spec §6.2). */
export function normalizeRing(points: readonly Point[]): Point[] {
  const key = (p: Point) => `${p.x_nm},${p.y_nm}`;
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (key(points[i]!) < key(points[start]!)) start = i;
  }
  const rotated = [...points.slice(start), ...points.slice(0, start)];
  let area2 = 0;
  for (let i = 0; i < rotated.length; i++) {
    const a = rotated[i]!;
    const b = rotated[(i + 1) % rotated.length]!;
    area2 += a.x_nm * b.y_nm - b.x_nm * a.y_nm;
  }
  return area2 < 0 ? [rotated[0]!, ...rotated.slice(1).reverse()] : rotated;
}

function duplicatePoint(points: readonly Point[]): boolean {
  const seen = new Set<string>();
  for (const p of points) {
    const key = `${p.x_nm},${p.y_nm}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function segmentIntersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x_nm - o.x_nm) * (q.y_nm - o.y_nm) - (p.y_nm - o.y_nm) * (q.x_nm - o.x_nm);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Simple polygon: among the closed edges, no two edges may intersect unless they are adjacent. */
function selfIntersects(points: readonly Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (i === j || (i + 1) % n === j || (j + 1) % n === i) continue;
      if (segmentIntersects(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) {
        return true;
      }
    }
  }
  return false;
}

function layerName(cell: Cell, line: Line, diagnostics: Diagnostics, file: string): string {
  const text = cell.text;
  if (!COPPER_LAYER.test(text) && !DIELECTRIC_LAYER.test(text)) {
    diagnostics.add(
      "error",
      "value.layer-name-invalid",
      `invalid layer name: ${text}`,
      file,
      line.number,
      cell.col,
      { expected: "F.Cu / In1.Cu / B.Cu / prepreg / core / d1…", actual: text },
    );
  }
  return text;
}

function copperLayer(cell: Cell, line: Line, diagnostics: Diagnostics, file: string): string {
  const text = cell.text;
  if (!COPPER_LAYER.test(text)) {
    diagnostics.add(
      "error",
      "value.layer-name-invalid",
      `a copper layer is required here: ${text}`,
      file,
      line.number,
      cell.col,
      { expected: "F.Cu / In1.Cu / B.Cu", actual: text },
    );
  }
  return text;
}

function netId(cell: Cell): string {
  return cell.text;
}

/** `pad_ref`: `<instance_id>.<pad_number>`; the instance ID may contain `.`. */
function padRef(cell: Cell, line: Line, diagnostics: Diagnostics, file: string): string {
  const text = cell.text;
  if (!text.includes(".") || text.startsWith(".") || text.endsWith(".")) {
    diagnostics.add(
      "error",
      "syntax.invalid-ref",
      `a pad ref must be written as <instance_id>.<pad_number>: ${text}`,
      file,
      line.number,
      cell.col,
    );
  }
  return text;
}

function enumCell(
  cell: Cell,
  line: Line,
  diagnostics: Diagnostics,
  file: string,
  allowed: ReadonlySet<string>,
  what: string,
): string {
  if (!allowed.has(cell.text)) {
    diagnostics.add(
      "error",
      "value.unknown-pcb-type",
      `unknown ${what}: ${cell.text}`,
      file,
      line.number,
      cell.col,
      { expected: [...allowed].join(" / "), actual: cell.text, data: { field: what } },
    );
  }
  return cell.text;
}

/** Parse a `pcb` description. */
export function parsePcb(text: string, options: PcbParseOptions): PcbParseResult {
  const diagnostics = new Diagnostics();
  const file = options.file;
  const lexed = lex(text);
  const src = new SourceFile(file, lexed);
  const lines = lexed.filter((line) => !line.blank && !line.comment);

  if (lines.length === 0) {
    diagnostics.add("error", "syntax.header-invalid", "the file is empty", file, 1, 1);
    return { ok: false, diagnostics: diagnostics.items };
  }

  // Header: `version <ver>` / `pcb <id>`.
  const versionLine = lines[0]!;
  if (versionLine.cells[0]?.text !== "version") {
    diagnostics.add("error", "syntax.header-invalid", "the first line must be version <ver>", file, 1, 1);
    return { ok: false, diagnostics: diagnostics.items };
  }
  const format = versionLine.cells[1]?.text ?? "";
  const verdict = checkVersion(format, VERSION_RANGE, "pcb");
  if (!verdict.ok) {
    diagnostics.add(
      "error",
      verdict.code,
      verdict.message,
      file,
      versionLine.number,
      versionLine.cells[1]?.col ?? 1,
    );
  }

  const typeLine = lines[1];
  if (
    typeLine === undefined ||
    typeLine.cells[0]?.text !== "pcb" ||
    typeLine.cells[1] === undefined
  ) {
    diagnostics.add("error", "syntax.header-invalid", "the second line must be pcb <board_id>", file, 2, 1);
    return { ok: false, diagnostics: diagnostics.items };
  }
  const id = typeLine.cells[1].text;
  if (!/^[A-Za-z0-9_+-]+$/.test(id)) {
    diagnostics.add("error", "syntax.invalid-identifier", `invalid id: ${id}`, file, typeLine.number, typeLine.cells[1].col);
  }
  if (id !== options.board) {
    diagnostics.add(
      "error",
      "ref.pcb-id-mismatch",
      `pcb id (${id}) must match the board id (${options.board}): sch and pcb describe the same board`,
      file,
      typeLine.number,
      typeLine.cells[1].col,
      { expected: options.board, actual: id },
    );
  }

  const { blocks, scalars } = splitSections(lines.slice(2), diagnostics, file);

  /* -------- scalars -------- */

  let boardThicknessNm: number | undefined;
  for (const line of scalars) {
    if (!exactColumns(line, 2, diagnostics, file)) continue;
    boardThicknessNm = length(line.cells[1]!, line, diagnostics, file);
  }
  if (boardThicknessNm === undefined) {
    diagnostics.add(
      "error",
      "syntax.unknown-field",
      "missing required scalar board_thickness",
      file,
      1,
      1,
      { expected: "board_thickness <length>", hint: "for example board_thickness 1.6mm" },
    );
  }

  const seen = new Set<Section>();
  const stackup: StackupLayer[] = [];
  const outline: Point[] = [];
  const place: Placement[] = [];
  const connect: ConnectEdge[] = [];
  const trace: Trace[] = [];
  const via: Via[] = [];
  const zone: Zone[] = [];
  const keepout: Keepout[] = [];
  const rules: Rule[] = [];
  const silk: Silk[] = [];
  const physicalOnly: PhysicalOnly[] = [];
  const deviation: Deviation[] = [];

  // Spans of the records built below, by object identity; the IR arrays get sorted at the end, and
  // only then does an index mean something (ADR-0103 D2/D4).
  const at = new Map<object, Span>();
  const put = <T extends object>(list: T[], item: T, line: Line): void => {
    list.push(item);
    at.set(item, src.span(line.number, line.cells[0]?.col));
  };

  for (const block of blocks) {
    // A section may repeat: rows are concatenated in order of appearance (merging same-name net rows in `teda.md` is the same precedent).
    // The order of `stackup` is the stackup order, so a repeated section is appended in order of appearance, not sorted.
    seen.add(block.section);

    for (const line of block.rows) {
      const c = line.cells;
      switch (block.section) {
        case "stackup": {
          const kind = c[1]?.text;
          if (kind === "copper") {
            if (!exactColumns(line, 4, diagnostics, file)) break;
            const layer = copperLayer(c[0]!, line, diagnostics, file);
            put(stackup, {
              type: "copper",
              layer,
              thickness_nm: length(c[2]!, line, diagnostics, file),
              kind: enumCell(c[3]!, line, diagnostics, file, KINDS, "copper layer type") as "signal" | "power" | "plane",
            }, line);
          } else if (kind === "dielectric") {
            const ok = c.length === 4 || c.length === 5;
            if (!ok) {
              diagnostics.add(
                "error",
                c.length < 4 ? "syntax.row-too-short" : "syntax.column-count",
                `<name> dielectric <thickness> <material> [er]`,
                file,
                line.number,
                c[0]!.col,
              );
              break;
            }
            const layer = layerName(c[0]!, line, diagnostics, file);
            put(stackup, {
              type: "dielectric",
              layer,
              thickness_nm: length(c[2]!, line, diagnostics, file),
              material: c[3]!.text,
              ...(c[4] === undefined ? {} : { er_ppm: ratioPpm(c[4], line, diagnostics, file) }),
            }, line);
          } else {
            diagnostics.add(
              "error",
              "value.unknown-pcb-type",
              `the second column of a stackup row must be copper / dielectric: ${kind ?? "missing"}`,
              file,
              line.number,
              c[1]?.col ?? c[0]!.col,
              { expected: "copper <thickness> <kind> | dielectric <thickness> <material> [er]" },
            );
          }
          break;
        }
        case "outline": {
          if (!exactColumns(line, 2, diagnostics, file)) break;
          put(outline, {
            x_nm: length(c[0]!, line, diagnostics, file),
            y_nm: length(c[1]!, line, diagnostics, file),
          }, line);
          break;
        }
        case "place": {
          if (!exactColumns(line, 5, diagnostics, file)) break;
          put(place, {
            instance_id: c[0]!.text,
            x_nm: length(c[1]!, line, diagnostics, file),
            y_nm: length(c[2]!, line, diagnostics, file),
            rot_mdeg: angle(c[3]!, line, diagnostics, file),
            side: enumCell(c[4]!, line, diagnostics, file, SIDES, "side") as "top" | "bottom",
          }, line);
          break;
        }
        case "connect": {
          if (!exactColumns(line, 2, diagnostics, file)) break;
          // Sort the pair internally by byte order (spec §6.2): the IR itself is canonical, the formatter cannot be relied on to catch it.
          const left = padRef(c[0]!, line, diagnostics, file);
          const right = padRef(c[1]!, line, diagnostics, file);
          put(connect, byteCompare(left, right) <= 0 ? { a: left, b: right } : { a: right, b: left }, line);
          break;
        }
        case "trace": {
          if (!atLeastColumns(line, 6, diagnostics, file, "<net> <layer> <width> <x1> <y1> [<x2> <y2> …]")) break;
          const points = pointList(c.slice(3), line, diagnostics, file, 2);
          if (points === undefined) break;
          put(trace, {
            net: netId(c[0]!),
            layer: copperLayer(c[1]!, line, diagnostics, file),
            width_nm: length(c[2]!, line, diagnostics, file),
            points: points as Trace["points"],
          }, line);
          break;
        }
        case "via": {
          const ok = c.length === 5 || c.length === 7;
          if (!ok) {
            diagnostics.add(
              "error",
              c.length < 5 ? "syntax.row-too-short" : "syntax.column-count",
              `<net> <x> <y> <size> <drill> [<from_layer> <to_layer>]`,
              file,
              line.number,
              c[0]!.col,
            );
            break;
          }
          const from = c[5];
          const to = c[6];
          put(via, {
            net: netId(c[0]!),
            x_nm: length(c[1]!, line, diagnostics, file),
            y_nm: length(c[2]!, line, diagnostics, file),
            size_nm: length(c[3]!, line, diagnostics, file),
            drill_nm: length(c[4]!, line, diagnostics, file),
            ...(from === undefined || to === undefined
              ? {}
              : {
                  from_layer: copperLayer(from, line, diagnostics, file),
                  to_layer: copperLayer(to, line, diagnostics, file),
                }),
          }, line);
          break;
        }
        case "zone":
        case "keepout": {
          const head = atLeastColumns(line, block.section === "zone" ? 4 : 4, diagnostics, file, block.section === "zone" ? "<net> <layer> <x1> <y1> …" : "<type> <layer> <x1> <y1> …");
          if (!head) break;
          const points = pointList(c.slice(2), line, diagnostics, file, 3);
          if (points === undefined) break;
          if (block.section === "zone") {
            put(zone, {
              net: netId(c[0]!),
              layer: copperLayer(c[1]!, line, diagnostics, file),
              points: normalizeRing(points) as Zone["points"],
            }, line);
          } else {
            put(keepout, {
              type: enumCell(c[0]!, line, diagnostics, file, KEEPOUT_TYPES, "keepout type") as Keepout["type"],
              layer: copperLayer(c[1]!, line, diagnostics, file),
              points: normalizeRing(points) as Zone["points"],
            }, line);
          }
          break;
        }
        case "rules": {
          const kind = c[0]!.text;
          const columns = RULE_COLUMNS[kind];
          if (columns === undefined) {
            diagnostics.add(
              "error",
              "value.unknown-pcb-type",
              `unknown rule type: ${kind}`,
              file,
              line.number,
              c[0]!.col,
              { expected: Object.keys(RULE_COLUMNS).join(" / "), actual: kind, data: { section: "rules" } },
            );
            break;
          }
          if (!exactColumns(line, columns, diagnostics, file)) break;
          const nm = (i: number) => length(c[i]!, line, diagnostics, file);
          switch (kind) {
            case "clearance":
              put(rules, { type: "clearance", value_nm: nm(1) }, line);
              break;
            case "width":
              put(rules, { type: "width", value_nm: nm(1) }, line);
              break;
            case "via":
              put(rules, { type: "via", size_nm: nm(1), drill_nm: nm(2) }, line);
              break;
            case "net":
              put(rules, {
                type: "net",
                net: netId(c[1]!),
                clearance_nm: nm(2),
                width_nm: nm(3),
                via_size_nm: nm(4),
                via_drill_nm: nm(5),
              }, line);
              break;
            case "diff": {
              const impedance = parseQuantity(c[3]!.text, "impedance", { code: "value.invalid-unit" });
              if (!impedance.ok) {
                diagnostics.add("error", "value.invalid-unit", impedance.reason, file, line.number, c[3]!.col, { actual: c[3]!.text });
                break;
              }
              put(rules, {
                type: "diff",
                net_a: netId(c[1]!),
                net_b: netId(c[2]!),
                impedance_mohm: impedance.value,
                gap_nm: nm(4),
              }, line);
              break;
            }
            case "match":
              put(rules, { type: "match", net_a: netId(c[1]!), net_b: netId(c[2]!), max_delta_nm: nm(3) }, line);
              break;
            case "mask":
              put(rules, { type: "mask", expansion_nm: nm(1) }, line);
              break;
            case "paste": {
              put(rules, { type: "paste", ratio_ppm: ratioPpm(c[1]!, line, diagnostics, file), offset_nm: nm(2) }, line);
              break;
            }
            case "thermal":
              put(rules, { type: "thermal", gap_nm: nm(1), bridge_nm: nm(2) }, line);
              break;
            case "min_width":
              put(rules, { type: "min_width", value_nm: nm(1) }, line);
              break;
          }
          break;
        }
        case "silk": {
          if (!exactColumns(line, 4, diagnostics, file)) break;
          put(silk, {
            item: enumCell(c[0]!, line, diagnostics, file, SILK_ITEMS, "silk item") as "refdes" | "value",
            layer: enumCell(c[1]!, line, diagnostics, file, SILK_LAYERS, "silk layer") as "F.SilkS" | "B.SilkS",
            size_nm: length(c[2]!, line, diagnostics, file),
            mode: enumCell(c[3]!, line, diagnostics, file, SILK_MODES, "silk mode") as "show" | "hide",
          }, line);
          const size = silk[silk.length - 1]!.size_nm;
          if (size < 500_000) {
            diagnostics.add(
              "warning",
              "drc.silk-small",
              `silk text height ${size / 1e6}mm is smaller than 0.5mm, hard to read at most board houses`,
              file,
              line.number,
              c[2]!.col,
              { data: { size_nm: size } },
            );
          }
          break;
        }
        case "physical_only": {
          const kind = c[1]?.text;
          if (kind === undefined) {
            diagnostics.add("error", "syntax.row-too-short", "<id> <type> [parameters…]", file, line.number, c[0]!.col);
            break;
          }
          enumCell(c[1]!, line, diagnostics, file, PHYSICAL_ONLY_TYPES, "physical entity type");
          const id = c[0]!.text;
          const nm = (i: number) => length(c[i]!, line, diagnostics, file);
          switch (kind) {
            case "mounting":
              if (!exactColumns(line, 6, diagnostics, file)) break;
              put(physicalOnly, {
                type: "mounting",
                id,
                x_nm: nm(2),
                y_nm: nm(3),
                size_nm: nm(4),
                drill_nm: nm(5),
              }, line);
              break;
            case "fiducial":
              if (!exactColumns(line, 6, diagnostics, file)) break;
              put(physicalOnly, {
                type: "fiducial",
                id,
                x_nm: nm(2),
                y_nm: nm(3),
                size_nm: nm(4),
                layer: copperLayer(c[5]!, line, diagnostics, file),
              }, line);
              break;
            case "stitching":
              if (!exactColumns(line, 7, diagnostics, file)) break;
              put(physicalOnly, {
                type: "stitching",
                id,
                x_nm: nm(2),
                y_nm: nm(3),
                net: netId(c[4]!),
                size_nm: nm(5),
                drill_nm: nm(6),
              }, line);
              break;
            case "cutout":
              if (!exactColumns(line, 6, diagnostics, file)) break;
              put(physicalOnly, { type: "cutout", id, x_nm: nm(2), y_nm: nm(3), w_nm: nm(4), h_nm: nm(5) }, line);
              break;
          }
          break;
        }
        case "deviation": {
          const kind = c[0]!.text;
          enumCell(c[0]!, line, diagnostics, file, DEVIATION_TYPES, "deviation type");
          if (kind === "net_tie") {
            if (!exactColumns(line, 3, diagnostics, file)) break;
            put(deviation, { type: "net_tie", net_a: netId(c[1]!), net_b: netId(c[2]!) }, line);
          } else if (kind === "split_ground") {
            if (!exactColumns(line, 2, diagnostics, file)) break;
            put(deviation, { type: "split_ground", net: netId(c[1]!) }, line);
          }
          break;
        }
      }
    }
  }

  /* -------- required sections -------- */

  for (const required of ["stackup", "outline", "place", "connect", "rules"] as const) {
    if (!seen.has(required)) {
      diagnostics.add(
        "error",
        "syntax.unknown-section",
        `missing required section: ${required} (spec/pcb.md §3)`,
        file,
        1,
        1,
        { expected: required },
      );
    }
  }

  /* -------- cross-row consistency -------- */

  // Stackup: first and last must be copper; inner copper layers must be numbered consecutively.
  const copper = stackup.filter((layer) => layer.type === "copper");
  if (stackup.length > 0) {
    if (stackup[0]!.type !== "copper" || stackup[stackup.length - 1]!.type !== "copper") {
      diagnostics.add(
        "error",
        "value.layer-order",
        "the first and last stackup entries must be copper layers",
        file,
        1,
        1,
      );
    }
    const inner = copper
      .map((layer) => layer.layer)
      .filter((name) => name.startsWith("In"))
      .map((name) => Number(/^In(\d+)\.Cu$/.exec(name)![1]));
    inner.sort((a, b) => a - b);
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] !== i + 1) {
        diagnostics.add(
          "error",
          "value.layer-order",
          `inner copper layers must be numbered consecutively from In1.Cu: In${i + 1}.Cu is missing`,
          file,
          1,
          1,
          { expected: `In${i + 1}.Cu` },
        );
        break;
      }
    }
  }

  // Board thickness = sum of layer thicknesses (solder mask and silkscreen not counted; tolerance 0.05mm, spec §5.2 rule 9).
  if (boardThicknessNm !== undefined && stackup.length > 0) {
    const sum = stackup.reduce((total, layer) => total + layer.thickness_nm, 0);
    if (Math.abs(sum - boardThicknessNm) > 50_000) {
      diagnostics.add(
        "error",
        "value.thickness-mismatch",
        `board_thickness ${boardThicknessNm / 1e6}mm does not match the sum of stackup thicknesses ${sum / 1e6}mm (tolerance 0.05mm)`,
        file,
        1,
        1,
        { expected: `${sum}`, actual: `${boardThicknessNm}`, data: { sum_nm: sum, board_thickness_nm: boardThicknessNm } },
      );
    }
  }

  // Board outline: at least 3 points, no duplicates, no self-intersection.
  if (outline.length > 0 && seen.has("outline")) {
    const ring = normalizeRing(outline);
    if (ring.length < 3) {
      diagnostics.add("error", "value.outline-invalid", `the board outline needs at least 3 vertices, got ${ring.length}`, file, 1, 1);
    } else if (duplicatePoint(ring)) {
      diagnostics.add("error", "value.outline-invalid", "the board outline has duplicate vertices", file, 1, 1);
    } else if (selfIntersects(ring)) {
      diagnostics.add("error", "value.outline-invalid", "the board outline self-intersects: vertices must be given in order along the board edge", file, 1, 1);
    }
  }

  // Placement: instance ids must not repeat.
  const placed = new Set<string>();
  for (const item of place) {
    if (placed.has(item.instance_id)) {
      diagnostics.add(
        "error",
        "value.duplicate-instance",
        `instance ${item.instance_id} was placed twice`,
        file,
        1,
        1,
        { expected: "each instance appears only once in place", actual: item.instance_id, data: { instance_id: item.instance_id } },
      );
      continue;
    }
    placed.add(item.instance_id);
  }

  // connect: dedupe pad pairs (writing the same pair twice carries no extra meaning).
  const edges = new Set<string>();
  for (const edge of connect) {
    const key = edge.a <= edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`;
    if (edges.has(key)) {
      diagnostics.add(
        "error",
        "value.duplicate-field",
        `duplicate pad pair in connect: ${edge.a} ${edge.b}`,
        file,
        1,
        1,
        { actual: `${edge.a} ${edge.b}` },
      );
      continue;
    }
    edges.add(key);
  }

  const ir: Pcb = {
    ir_version: irVersion,
    // The canonical spelling of the version: `0.6` and `0.6.0` are the same version, so the IR stores one of them.
    format: verdict.ok ? verdict.text : format,
    source: { file, line: 1 },
    board: options.board,
    board_thickness_nm: boardThicknessNm ?? 0,
    stackup: stackup as Pcb["stackup"],
    outline: normalizeRing(outline) as Pcb["outline"],
    place: [...place].sort((a, b) => (a.instance_id < b.instance_id ? -1 : a.instance_id > b.instance_id ? 1 : 0)),
    connect: [...connect].sort((x, y) => {
      const left = x.a <= x.b ? `${x.a}|${x.b}` : `${x.b}|${x.a}`;
      const right = y.a <= y.b ? `${y.a}|${y.b}` : `${y.b}|${y.a}`;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
    ...(trace.length > 0
      ? {
          trace: sortByKey(
            trace.map((item) => {
              const mapped = { ...item, points: orientTrace(item.points) as Trace["points"] };
              // The oriented copy is a new object; carry the record's span over to it.
              const span = at.get(item);
              if (span !== undefined) at.set(mapped, span);
              return mapped;
            }),
            (t) => `${t.net}|${t.layer}|${t.points[0]!.x_nm},${t.points[0]!.y_nm}`,
          ),
        }
      : {}),
    ...(via.length > 0 ? { via: sortByKey(via, (v) => `${v.net}|${v.x_nm}|${v.y_nm}`) } : {}),
    ...(zone.length > 0 ? { zone: sortByKey(zone, (z) => `${z.net}|${z.layer}|${z.points[0]!.x_nm},${z.points[0]!.y_nm}`) } : {}),
    ...(keepout.length > 0 ? { keepout: sortByKey(keepout, (k) => `${k.type}|${k.layer}|${k.points[0]!.x_nm},${k.points[0]!.y_nm}`) } : {}),
    rules: [...rules].sort((a, b) => {
      const order = RULE_ORDER.indexOf(a.type) - RULE_ORDER.indexOf(b.type);
      return order !== 0 ? order : byteCompare(JSON.stringify(a), JSON.stringify(b));
    }),
    ...(silk.length > 0 ? { silk: sortByKey(silk, (s) => s.item) } : {}),
    ...(physicalOnly.length > 0 ? { physical_only: sortByKey(physicalOnly, (p) => p.id) } : {}),
    ...(deviation.length > 0 ? { deviation: sortByKey(deviation, (d) => `${d.type}|${"net_a" in d ? d.net_a : d.net}`) } : {}),
  };

  // IR path → span, keyed by the canonical index of each record (ADR-0103 D2).
  const sources: SourceMap = new Map();
  recordObjects(sources, "/stackup", stackup, at);
  recordObjects(sources, "/place", ir.place, at);
  recordObjects(sources, "/connect", ir.connect, at);
  recordObjects(sources, "/trace", ir.trace ?? [], at);
  recordObjects(sources, "/via", ir.via ?? [], at);
  recordObjects(sources, "/zone", ir.zone ?? [], at);
  recordObjects(sources, "/keepout", ir.keepout ?? [], at);
  recordObjects(sources, "/rules", ir.rules, at);
  recordObjects(sources, "/silk", ir.silk ?? [], at);
  recordObjects(sources, "/physical_only", ir.physical_only ?? [], at);
  recordObjects(sources, "/deviation", ir.deviation ?? [], at);
  recordObjects(sources, "/outline", ir.outline, at);

  return { ok: !diagnostics.hasError, ir, diagnostics: diagnostics.items, sources };
}

/** Polyline direction normalization: reverse the whole polyline when the start sorts after the end (spec §6.2). */
function orientTrace(points: readonly Point[]): Point[] {
  if (points.length < 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.x_nm < last.x_nm || (first.x_nm === last.x_nm && first.y_nm <= last.y_nm)) return [...points];
  return [...points].reverse();
}

function sortByKey<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}
