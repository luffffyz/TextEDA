// `texteda bom`: the board's bill of materials (`spec/procurement.md` §5).
//
// The BOM is the projection of the design and the procurement onto one table: a row per line,
// keyed by the device id and the parameter values, with the part that is bought, how many of them
// the board uses, and the state of the row.
//
// Three kinds of row (spec/procurement.md §5.1):
//   - a part the design names: the row carries that part;
//   - a generic line with a selection: the row carries the selected part;
//   - a generic line without one: **no part number**, the state says `unsourced`.
//
// The marker never goes into the part number cell: the exported BOM is consumed by an ordering
// system, and a part number that reads `unsourced` would be ordered as if it were a part
// (ADR-0022).
import { formatQuantity, parseProcurement, parseSchematic, type QuantityKind } from "@texteda/parser";
import type { Procurement } from "@texteda/ir/procurement";
import { buildBomLines } from "@texteda/core";
import { LAYOUT } from "./paths.ts";
import { writeOut } from "./output.ts";
import { loadBoard, loadComponents, loadModules, loadProcurement } from "./project.ts";
import { buildProcurementFacts } from "./procurement.ts";
import { loadFootprintLibrary, withPackageCodes } from "./pads.ts";
import type { VerbResult } from "./result.ts";

export interface BomOptions {
  root: string;
  board: string;
  json: boolean;
  outFile: string | undefined;
}

/** The columns of the table, in order. */
const COLUMNS = ["component_id", "mpn", "params", "quantity", "status", "refdes", "note"] as const;

/** Quote a CSV cell: a comma, a quote or a newline forces the quotes. */
function csvCell(text: string): string {
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Render the parameter values of a row the way a person writes them: `10kΩ ±1%`. */
function renderParams(
  params: Readonly<Record<string, number | string>>,
  types: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  for (const [role, value] of Object.entries(params)) {
    const type = types.get(role);
    if (typeof value === "string") {
      parts.push(`${role}=${value}`);
      continue;
    }
    if (type === undefined) {
      parts.push(`${role}=${value}`);
      continue;
    }
    parts.push(formatQuantity(value, type as QuantityKind));
  }
  return parts.join(" ");
}

/** One row of the machine payload: the same fields the CSV table has, minus the note column. */
export interface BomLinePayload {
  component_id: string;
  mpn: string;
  params: Readonly<Record<string, number | string>>;
  quantity: number;
  status: "bought" | "unsourced" | "not-required";
  part?: string;
  refdes: readonly string[];
}

/** The machine payload of the BOM: what `texteda bom --json` prints. */
export interface BomPayload {
  board: string;
  lines: BomLinePayload[];
}

export interface BomValue {
  /** The machine payload. */
  readonly payload: BomPayload;
  /** The CSV table: what the default output prints. */
  readonly csv: string;
}

/**
 * The board's bill of materials, as a value.
 *
 * The command line prints it and a host's tool registry hands it back; both call this function, so
 * the two faces cannot drift (ADR-0044 D2).
 */
export function buildBom(options: { root: string; board: string }): VerbResult<BomValue> {
  const { root, board } = options;
  const loaded = loadBoard(root, board);
  if (!loaded) {
    return { ok: false, code: "cli.bad-usage", error: `Board root file not found: ${LAYOUT.sch}/${board}.teda` };
  }
  const { resolver, problems, devices: loadedDevices } = loadComponents(root);
  if (problems.length > 0) {
    const lines = problems.map((problem) => `Component index: ${problem.file}:${problem.line}: ${problem.message}`);
    return { ok: false, error: lines.join("\n") };
  }

  const schematic = parseSchematic(loaded.text, {
    file: loaded.file,
    board,
    components: resolver,
    modules: loadModules(root),
  });
  if (!schematic.ir) {
    const lines = schematic.diagnostics.map((diagnostic) => {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      return `${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
    });
    return { ok: false, error: lines.join("\n") };
  }

  const procurements: { ir: Procurement; file: string }[] = [];
  for (const role of ["primary", "alternatives"] as const) {
    const source = loadProcurement(root, board, role);
    if (!source) continue;
    const parsed = parseProcurement(source.text, {
      file: source.file,
      board,
      role,
      components: resolver,
    });
    if (parsed.ir) procurements.push({ ir: parsed.ir, file: source.file });
  }

  // The package floor (ADR-0027) is keyed by the land pattern's package code, so the devices are
  // decorated the same way `check` does it: the BOM and the check must not disagree on a selection.
  const devices = withPackageCodes(loadedDevices, loadFootprintLibrary(root));
  const facts = buildProcurementFacts({ schematic: schematic.ir, procurements, devices });
  const lines = buildBomLines(facts);

  // The quantity column of a row needs the device's own parameter types, to write `10kΩ` and not
  // `10000000000`.
  const types = new Map<string, string>();
  for (const device of devices.values()) {
    for (const param of device.params) types.set(`${device.id}.${param.name}`, param.type);
  }

  const payload: BomPayload = {
    board,
    lines: lines.map((line) => ({
      component_id: line.component,
      mpn: line.mpn,
      params: line.params,
      quantity: line.quantity,
      status: line.status,
      ...(line.part ? { part: line.part } : {}),
      refdes: line.instances,
    })),
  };

  const rows: string[] = [COLUMNS.join(",")];
  for (const line of lines) {
    const deviceTypes = new Map<string, string>();
    for (const [role, type] of types) {
      const [id, name] = role.split(".");
      if (id === line.component) deviceTypes.set(name!, type);
    }
    rows.push(
      [
        line.component,
        line.mpn,
        renderParams(line.params, deviceTypes),
        String(line.quantity),
        line.status,
        line.instances.join(" "),
        "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { ok: true, value: { payload, csv: `${rows.join("\n")}\n` } };
}

/** Write the board's BOM. Returns the process exit code. */
export function runBom(options: BomOptions): number {
  const { root, board, json, outFile } = options;
  const built = buildBom({ root, board });
  if (!built.ok) {
    console.error(built.error ?? "The bill of materials could not be built");
    return built.error?.startsWith("Board root file not found") ? 2 : 1;
  }
  const text = json ? `${JSON.stringify(built.value!.payload, null, 2)}\n` : built.value!.csv;
  if (outFile) {
    writeOut(outFile, text);
    console.error(`Wrote ${outFile}`);
  } else {
    console.log(text.trimEnd());
  }
  return 0;
}
