// `footprint` description parsing: `.teda` source → IR fragment (spec/footprint.md).
//
// Surface parsing and unit conversion only; contract validation is delegated to @texteda/ir schema validation (closed-set schema);
// library-level checks (pin number comparison, DRC) do not live at this layer (ADR-0010 decision 3).
import { irVersion } from "@texteda/ir";
import type { Footprint } from "@texteda/ir/footprint";
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";
import { lex, type Cell, type Line } from "./lexer.ts";
import { byteCompare, naturalCompare } from "@texteda/ir/order";
import { parseAngleMdeg, parseLengthNm, parsePpm } from "./units.ts";
import { checkVersion, typeRange } from "./version.ts";

// Section key sets are exported for fmt reuse: both places must agree on one lexicon, not each write its own.
export const SECTIONS = new Set(["pads", "graphics"]);
export const SCALAR_KEYS = new Set(["description", "tags", "attr", "package_code", "model", "field"]);
export const PAD_KEYS = new Set([
  "rot",
  "drill",
  "rratio",
  "mask",
  "paste",
  "zone",
  "thermal_w",
  "thermal_g",
  "layers",
]);
export const GRAPHIC_KEYS = new Set(["width", "fill"]);
export const FIELD_KEYS = new Set(["at", "layer", "hide", "size", "thickness"]);
export const MODEL_KEYS = new Set(["offset", "scale", "rot"]);
const PAD_TYPES = new Set(["smd", "th"]);
const PAD_SHAPES = new Set(["rect", "roundrect", "oval", "circle"]);
const GRAPHIC_KINDS = new Set(["line", "rect", "circle", "arc", "poly"]);
const ZONE_KINDS = new Set(["solid", "thermal", "none"]);
const ATTRS = new Set(["smd", "through_hole", "virtual", "board_only"]);
const FOOTPRINT_ID_RE = /^[A-Za-z0-9_.+-]+$/;
const PIN_NUMBER_RE = /^[A-Za-z0-9_+-]+$/;
const LAYER_RE = /^[A-Za-z0-9_.+-]+$/;
/** `footprint` was introduced in 0.4: files below 0.4 do not have this type. */
const VERSION_RANGE = typeRange("footprint");

export interface ParseOptions {
  /** File name (for diagnostics). */
  file: string;
  /** Library name; IR's `footprint.library` comes from the library catalog, not from the file content. */
  library: string;
}

export interface ParseResult {
  ok: boolean;
  ir?: Footprint;
  diagnostics: Diagnostic[];
}

type Pad = Footprint["footprint"]["pads"][number];
type Graphic = NonNullable<Footprint["footprint"]["graphics"]>[number];
type Field = NonNullable<Footprint["footprint"]["fields"]>[number];

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  error(file: string, line: number, col: number, code: DiagnosticCodeId, message: string): void {
    this.diagnostics.push({ code, severity: "error", message, location: { file, line, col } });
  }

  get hasError(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

/** Parse trailing `key=value` columns; report an error for unknown keys. Structural problems always use syntax-domain codes, separate from "invalid value". */
function readKeyValues(
  cells: Cell[],
  allowed: Set<string>,
  file: string,
  line: number,
  out: Map<string, string>,
  collector: Collector,
): void {
  for (const cell of cells) {
    const eq = cell.text.indexOf("=");
    if (eq <= 0) {
      collector.error(file, line, cell.col, "syntax.invalid-token", `unrecognized cell: ${cell.text}`);
      continue;
    }
    const key = cell.text.slice(0, eq);
    if (!allowed.has(key)) {
      collector.error(file, line, cell.col, "syntax.unknown-field", `unknown key: ${key}`);
      continue;
    }
    if (out.has(key)) {
      collector.error(file, line, cell.col, "syntax.duplicate-key", `duplicate key: ${key}`);
      continue;
    }
    out.set(key, cell.text.slice(eq + 1));
  }
}

/** Parse a list of numbers in `x,y` form (lengths). */
function readLengthList(
  text: string,
  file: string,
  line: number,
  col: number,
  code: DiagnosticCodeId,
  collector: Collector,
): number[] | null {
  const parts = text.split(",");
  const values: number[] = [];
  for (const part of parts) {
    const parsed = parseLengthNm(part, file, line, col, "mm", code);
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
      return null;
    }
    values.push(parsed.value!);
  }
  return values;
}

function parsePadRow(
  cells: Cell[],
  file: string,
  line: number,
  collector: Collector,
): Pad | null {
  if (cells.length < 7) {
    collector.error(file, line, cells[0]?.col ?? 1, "syntax.row-too-short", "a pads row needs at least 7 columns: number type shape x y w h");
    return null;
  }
  // Column count already validated above; indexing here, the first 7 columns are guaranteed to exist.
  const firstCell = cells[0]!;
  const number = cells[0]!;
  const type = cells[1]!;
  const shape = cells[2]!;
  const x = cells[3]!;
  const y = cells[4]!;
  const w = cells[5]!;
  const h = cells[6]!;
  if (!PIN_NUMBER_RE.test(number.text)) {
    collector.error(file, line, number.col, "value.pad-number-invalid", `invalid pad number: ${number.text}`);
    return null;
  }
  if (!PAD_TYPES.has(type.text)) {
    collector.error(file, line, type.col, "value.pad-type-unknown", `unknown pad type: ${type.text}`);
    return null;
  }
  if (!PAD_SHAPES.has(shape.text)) {
    collector.error(file, line, shape.col, "value.pad-shape-unknown", `unknown pad shape: ${shape.text}`);
    return null;
  }
  const nums: number[] = [];
  for (const cell of [x, y, w, h]) {
    const parsed = parseLengthNm(cell.text, file, line, cell.col, "mm", "value.pad-size-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
      return null;
    }
    nums.push(parsed.value!);
  }
  const sizeX = nums[2]!;
  const sizeY = nums[3]!;
  if (sizeX <= 0 || sizeY <= 0) {
    collector.error(file, line, w.col, "value.pad-size-invalid", "pad size must be positive");
    return null;
  }

  const kv = new Map<string, string>();
  readKeyValues(cells.slice(7), PAD_KEYS, file, line, kv, collector);

  const pad: Pad = {
    number: number.text,
    type: type.text as Pad["type"],
    shape: shape.text as Pad["shape"],
    at: { x_nm: nums[0]!, y_nm: nums[1]! },
    size: { x_nm: sizeX, y_nm: sizeY },
    layers: type.text === "th" ? ["*.Cu", "*.Mask"] : ["F.Cu", "F.Mask", "F.Paste"],
  };

  const rot = kv.get("rot");
  if (rot !== undefined) {
    const parsed = parseAngleMdeg(rot, file, line, firstCell.col, "deg", "value.pad-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      pad.at.rotation_mdeg = parsed.value;
    }
  }
  const drill = kv.get("drill");
  if (drill !== undefined) {
    const parsed = parseLengthNm(drill, file, line, firstCell.col, "mm", "value.pad-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      pad.drill = { x_nm: parsed.value, y_nm: parsed.value };
    }
  } else if (type.text === "th") {
    collector.error(file, line, firstCell.col, "value.pad-attribute-invalid", "a through-hole pad must have drill=");
  }
  const rratio = kv.get("rratio");
  if (rratio !== undefined) {
    if (shape.text !== "roundrect") {
      collector.error(file, line, firstCell.col, "value.pad-ratio-invalid", "rratio only applies to roundrect");
    }
    const parsed = parsePpm(rratio, file, line, firstCell.col, "value.pad-ratio-invalid");
    if (parsed.ok) pad.roundrect_ratio_ppm = parsed.value;
    else collector.diagnostics.push(parsed.diagnostic);
  }
  const mask = kv.get("mask");
  if (mask !== undefined) {
    const parsed = parseLengthNm(mask, file, line, firstCell.col, "mm", "value.pad-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      pad.solder_mask_margin_nm = parsed.value;
    }
  }
  const paste = kv.get("paste");
  if (paste !== undefined) {
    const parsed = parseLengthNm(paste, file, line, firstCell.col, "mm", "value.pad-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      pad.solder_paste_margin_nm = parsed.value;
    }
  }
  const zone = kv.get("zone");
  if (zone !== undefined) {
    if (!ZONE_KINDS.has(zone)) {
      collector.error(file, line, firstCell.col, "value.pad-connection-unknown", `unknown connection type: ${zone}`);
    } else {
      pad.zone_connect = zone as NonNullable<Pad["zone_connect"]>;
    }
  }
  const thermalW = kv.get("thermal_w");
  if (thermalW !== undefined) {
    const parsed = parseLengthNm(thermalW, file, line, firstCell.col, "mm", "value.pad-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      pad.thermal_width_nm = parsed.value;
    }
  }
  const thermalG = kv.get("thermal_g");
  if (thermalG !== undefined) {
    const parsed = parseLengthNm(thermalG, file, line, firstCell.col, "mm", "value.pad-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      pad.thermal_gap_nm = parsed.value;
    }
  }
  const layers = kv.get("layers");
  if (layers !== undefined) {
    const list = layers.split(",").filter((l) => l.length > 0);
    const [first, ...rest] = list;
    if (first === undefined || list.some((l) => !LAYER_RE.test(l))) {
      collector.error(file, line, firstCell.col, "value.layer-name-invalid", `invalid layer name: ${layers}`);
    } else {
      pad.layers = [first, ...rest];
    }
  }
  return pad;
}

function parseGraphicRow(
  cells: Cell[],
  file: string,
  line: number,
  collector: Collector,
): Graphic | null {
  if (cells.length < 3) {
    collector.error(file, line, cells[0]?.col ?? 1, "syntax.row-too-short", "a graphics row needs at least 3 columns: kind layer geometry");
    return null;
  }
  const firstCell = cells[0]!;
  const kindCell = cells[0]!;
  const layerCell = cells[1]!;
  const geometryCell = cells[2]!;
  if (!GRAPHIC_KINDS.has(kindCell.text)) {
    collector.error(file, line, kindCell.col, "value.graphic-invalid", `unknown graphic kind: ${kindCell.text}`);
    return null;
  }
  if (!LAYER_RE.test(layerCell.text)) {
    collector.error(file, line, layerCell.col, "value.graphic-invalid", `invalid layer name: ${layerCell.text}`);
    return null;
  }
  const values = readLengthList(geometryCell.text, file, line, geometryCell.col, "value.graphic-invalid", collector);
  if (values === null) return null;

  const graphic: Graphic = {
    kind: kindCell.text as Graphic["kind"],
    layer: layerCell.text,
  };

  const need = (count: number): boolean => {
    if (values.length !== count) {
      collector.error(
        file,
        line,
        geometryCell.col,
        "value.graphic-invalid",
        `${kindCell.text} geometry needs ${count} numbers, got ${values.length}`,
      );
      return false;
    }
    return true;
  };

  switch (kindCell.text) {
    case "line":
    case "rect": {
      if (!need(4)) return null;
      graphic.start = { x_nm: values[0]!, y_nm: values[1]! };
      graphic.end = { x_nm: values[2]!, y_nm: values[3]! };
      break;
    }
    case "circle": {
      if (!need(3)) return null;
      if (values[2]! <= 0) {
        collector.error(file, line, geometryCell.col, "value.graphic-invalid", "circle radius must be positive");
        return null;
      }
      graphic.center = { x_nm: values[0]!, y_nm: values[1]! };
      graphic.radius_nm = values[2]!;
      break;
    }
    case "arc": {
      if (!need(6)) return null;
      graphic.start = { x_nm: values[0]!, y_nm: values[1]! };
      graphic.mid = { x_nm: values[2]!, y_nm: values[3]! };
      graphic.end = { x_nm: values[4]!, y_nm: values[5]! };
      break;
    }
    case "poly": {
      if (values.length < 6 || values.length % 2 !== 0) {
        collector.error(file, line, geometryCell.col, "value.graphic-invalid", "poly needs at least 3 points (x,y alternating)");
        return null;
      }
      const points = [];
      for (let i = 0; i < values.length; i += 2) {
        points.push({ x_nm: values[i]!, y_nm: values[i + 1]! });
      }
      const [p0, p1, p2, ...rest] = points;
      if (p0 && p1 && p2) graphic.points = [p0, p1, p2, ...rest];
      break;
    }
  }

  const kv = new Map<string, string>();
  readKeyValues(cells.slice(3), GRAPHIC_KEYS, file, line, kv, collector);
  const width = kv.get("width");
  if (width !== undefined) {
    const parsed = parseLengthNm(width, file, line, firstCell.col, "mm", "value.graphic-attribute-invalid");
    if (!parsed.ok) {
      if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
    } else {
      graphic.width_nm = parsed.value;
    }
  }
  const fill = kv.get("fill");
  if (fill !== undefined) {
    if (kindCell.text === "line" || kindCell.text === "arc") {
      collector.error(file, line, firstCell.col, "value.graphic-attribute-invalid", "fill only applies to rect/circle/poly");
    } else if (fill !== "solid" && fill !== "none") {
      collector.error(file, line, firstCell.col, "value.graphic-attribute-invalid", `unknown fill: ${fill}`);
    } else {
      graphic.filled = fill === "solid";
    }
  }
  return graphic;
}

function graphicCoords(g: Graphic): number[] {
  switch (g.kind) {
    case "circle":
      return [g.center!.x_nm, g.center!.y_nm, g.radius_nm!];
    case "poly":
      return g.points!.flatMap((p) => [p.x_nm, p.y_nm]);
    case "arc":
      return [g.start!.x_nm, g.start!.y_nm, g.mid!.x_nm, g.mid!.y_nm, g.end!.x_nm, g.end!.y_nm];
    default:
      return [g.start!.x_nm, g.start!.y_nm, g.end!.x_nm, g.end!.y_nm];
  }
}

/** Canonical order of graphics: kind → layer → numeric coordinates item by item. */
function compareGraphics(a: Graphic, b: Graphic): number {
  const kind = byteCompare(a.kind, b.kind);
  if (kind !== 0) return kind;
  const layer = byteCompare(a.layer, b.layer);
  if (layer !== 0) return layer;
  const ca = graphicCoords(a);
  const cb = graphicCoords(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i += 1) {
    const diff = ca[i]! - cb[i]!;
    if (diff !== 0) return diff;
  }
  return ca.length - cb.length;
}

/** Parse a `footprint` file. */
export function parseFootprint(text: string, options: ParseOptions): ParseResult {
  const collector = new Collector();
  const { file } = options;
  const lines = lex(text);

  let index = 0;
  const nextMeaningful = (): Line | null => {
    while (index < lines.length) {
      const line = lines[index]!;
      if (line.blank || line.comment) {
        index += 1;
        continue;
      }
      index += 1; // consume this line
      return line;
    }
    return null;
  };

  // file header
  const versionLine = nextMeaningful();
  if (!versionLine || versionLine.cells.length !== 2 || versionLine.cells[0]!.text !== "version") {
    collector.error(file, versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const version = versionLine.cells[1]!.text;
  const verdict = checkVersion(version, VERSION_RANGE, "footprint");
  if (!verdict.ok) {
    collector.error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message);
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "footprint") {
    collector.error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be footprint <id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const name = typeLine.cells[1]!.text;
  if (!FOOTPRINT_ID_RE.test(name)) {
    collector.error(file, typeLine.number, typeLine.cells[1]!.col, "syntax.invalid-token", `invalid footprint name: ${name}`);
  }

  // Build a draft first, then assemble into the shape required by the closed-set contract (at least one pad).
  const body: Omit<Footprint["footprint"], "pads"> & {
    pads?: Footprint["footprint"]["pads"];
  } = {
    library: options.library,
    name,
  };
  const pads: Pad[] = [];
  const graphics: Graphic[] = [];
  const fields: Field[] = [];
  let section: "pads" | "graphics" | null = null;
  let model3d: Footprint["footprint"]["model3d"];

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1) {
      const head = line.cells[0]!.text;
      if (SECTIONS.has(head)) {
        section = head as "pads" | "graphics";
        continue;
      }
      if (section === null) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-section", `unknown section: ${head}`);
        continue;
      }
      collector.error(file, line.number, line.cells[0]!.col, "syntax.row-too-short", "a row in a section needs at least 2 cells");
      continue;
    }

    if (section === null) {
      // scalar
      const key = line.cells[0]!.text;
      if (!SCALAR_KEYS.has(key)) {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown scalar: ${key}`);
        continue;
      }
      const rest = line.cells.slice(1);
      const trailing = (from: number): string => rest.slice(from).map((c) => c.text).join(" ");
      switch (key) {
        case "description":
          body.description = trailing(0);
          break;
        case "tags": {
          const tags = trailing(0).split(/\s+/).filter((t) => t.length > 0);
          // It is a set: sort before entering the IR, so the IR depends only on semantics, not on the spelling order in the source.
          if (tags.length > 0) body.tags = [...tags].sort(byteCompare);
          break;
        }
        case "package_code": {
          const code = trailing(0);
          if (code.length === 0) {
            collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", "package_code requires a value");
          } else {
            body.package_code = code;
          }
          break;
        }
        case "attr": {
          const attr = trailing(0);
          if (!ATTRS.has(attr)) {
            collector.error(file, line.number, line.cells[1]!.col, "syntax.unknown-field", `unknown attr: ${attr}`);
          } else {
            const attrValue = attr as NonNullable<Footprint["footprint"]["attr"]>[number];
            body.attr = [attrValue];
          }
          break;
        }
        case "model": {
          const path = rest[0]?.text ?? "";
          if (rest.length === 0) {
            collector.error(file, line.number, line.cells[0]!.col, "library.model-invalid", "model requires a path");
            break;
          }
          const kv = new Map<string, string>();
          readKeyValues(rest.slice(1), MODEL_KEYS, file, line.number, kv, collector);
          const entry: NonNullable<Footprint["footprint"]["model3d"]> = { path };
          const offset = kv.get("offset");
          if (offset !== undefined) {
            const values = readLengthList(offset, file, line.number, rest[0]!.col, "library.model-invalid", collector);
            if (values && values.length === 3) {
              entry.offset_nm = [values[0]!, values[1]!, values[2]!];
            }
          }
          const scale = kv.get("scale");
          if (scale !== undefined) {
            const parts = scale.split(",");
            const ppm: number[] = [];
            let ok = parts.length === 3;
            for (const part of parts) {
              const parsedPpm = parsePpm(part, file, line.number, rest[0]!.col, "library.model-invalid");
              if (!parsedPpm.ok) {
                ok = false;
                collector.diagnostics.push(parsedPpm.diagnostic);
                continue;
              }
              if (parsedPpm.value <= 0) {
                ok = false;
                collector.error(file, line.number, rest[0]!.col, "library.model-invalid", `scale must be a positive number: ${part}`);
                continue;
              }
              ppm.push(parsedPpm.value);
            }
            if (ok && ppm.length === 3) {
              entry.scale_ppm = [ppm[0]!, ppm[1]!, ppm[2]!];
            } else if (parts.length !== 3) {
              collector.error(file, line.number, rest[0]!.col, "library.model-invalid", `scale requires 3 numbers: ${scale}`);
            }
          }
          const rot = kv.get("rot");
          if (rot !== undefined) {
            const values = rot.split(",");
            const parsed = values.map((v) => parseAngleMdeg(v, file, line.number, rest[0]!.col, "deg", "library.model-invalid"));
            const okAngles = parsed.filter((p) => p.ok);
            if (okAngles.length === 3) {
              entry.rotation_mdeg = [okAngles[0]!.value, okAngles[1]!.value, okAngles[2]!.value];
            }
            for (const p of parsed) {
              if (!p.ok) collector.diagnostics.push(p.diagnostic);
            }
          }
          model3d = entry;
          break;
        }
        case "field": {
          const fieldName = rest[0]?.text ?? "";
          if (rest.length === 0) {
            collector.error(file, line.number, line.cells[0]!.col, "library.field-invalid", "field requires a name");
            break;
          }
          if (fields.some((f) => f.name === fieldName)) {
            collector.error(file, line.number, rest[0]!.col, "library.field-invalid", `duplicate field name: ${fieldName}`);
          }
          // Consume key=value pairs from the trailing columns first; the rest (remaining text at line end) is the value
          let cursor = 1;
          const kv = new Map<string, string>();
          while (cursor < rest.length) {
            const cell = rest[cursor]!;
            const eq = cell.text.indexOf("=");
            if (eq <= 0) break;
            const key2 = cell.text.slice(0, eq);
            if (!FIELD_KEYS.has(key2)) break;
            kv.set(key2, cell.text.slice(eq + 1));
            cursor += 1;
          }
          const field: Field = { name: fieldName, value: trailing(cursor) };
          const at = kv.get("at");
          if (at !== undefined) {
            const values = readLengthList(at, file, line.number, rest[0]!.col, "library.field-invalid", collector);
            if (values && values.length === 2) {
              field.at = { x_nm: values[0]!, y_nm: values[1]! };
            }
          }
          const layer = kv.get("layer");
          if (layer !== undefined) field.layer = layer;
          const hide = kv.get("hide");
          if (hide !== undefined) field.hide = hide === "yes" || hide === "true";
          const size = kv.get("size");
          const thickness = kv.get("thickness");
          if (size !== undefined || thickness !== undefined) {
            const effects: NonNullable<Field["effects"]> = {};
            if (size !== undefined) {
              const values = readLengthList(size, file, line.number, rest[0]!.col, "library.field-invalid", collector);
              if (values && values.length === 2) {
                effects.width_nm = values[0]!;
                effects.height_nm = values[1]!;
              }
            }
            if (thickness !== undefined) {
              const parsed = parseLengthNm(thickness, file, line.number, rest[0]!.col, "mm", "library.field-invalid");
              if (parsed.ok) effects.thickness_nm = parsed.value;
              else if (parsed.diagnostic) collector.diagnostics.push(parsed.diagnostic);
            }
            field.effects = effects;
          }
          fields.push(field);
          break;
        }
      }
      continue;
    }

    // rows inside a section
    if (section === "pads") {
      const pad = parsePadRow(line.cells, file, line.number, collector);
      if (pad) pads.push(pad);
    } else {
      const graphic = parseGraphicRow(line.cells, file, line.number, collector);
      if (graphic) graphics.push(graphic);
    }
  }

  if (pads.length === 0) {
    collector.error(file, 1, 1, "library.pads-empty", "the pads section must not be empty");
  }
  const seen = new Set<string>();
  for (const pad of pads) {
    if (seen.has(pad.number)) {
      collector.error(file, 1, 1, "library.duplicate-pad-number", `duplicate pad number: ${pad.number}`);
    }
    seen.add(pad.number);
  }

  // The IR is a function of semantics: pads sorted by natural number order, graphics by (kind, layer, coordinates), fields by name; source file order is not preserved.
  pads.sort((a, b) => naturalCompare(a.number, b.number));
  graphics.sort(compareGraphics);
  fields.sort((a, b) => byteCompare(a.name, b.name));
  if (graphics.length > 0) body.graphics = graphics;
  if (fields.length > 0) body.fields = fields;
  if (model3d) body.model3d = model3d;
  const [firstPad, ...restPads] = pads;
  if (!firstPad) {
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const finalBody: Footprint["footprint"] = { ...body, pads: [firstPad, ...restPads] };

  const ir: Footprint = {
    ir_version: irVersion,
    source: { file, line: 1 },
    footprint: finalBody,
  };

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };
  return { ok: true, ir, diagnostics: collector.diagnostics };
}
