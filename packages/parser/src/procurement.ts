// `procurement` description parsing: `.teda` source → the procurement IR (spec/procurement.md, ADR-0029).
//
// A procurement description says which part is bought. It is a **project decision**: what the
// design needs lives in the schematic, what a part is lives in the device library, and what is
// bought lives here. Nothing in this file changes the circuit.
//
// The parsing has two levels, like the schematic's:
//
//   - the document level reads the file on its own: the syntax, the role, the rows as they are
//     written. It is what the canonical formatter needs.
//   - the board level adds what the project knows: the position of the file (which board, which
//     role) and the generic's parameter columns, which turn the row's cells into typed values.
//
// Whether the selected part satisfies the line is a cross-file question, and it belongs to the
// checker, not to the parser.
import { irVersion } from "@texteda/ir";
import type { Procurement, Selection } from "@texteda/ir/procurement";
import type { Diagnostic, DiagnosticCodeId, DiagnosticLocation } from "@texteda/ir/diagnostics";
import { DEVICE_ID_RE, QUALIFIED_REF_RE } from "./ids.ts";
import { lex, type Line } from "./lexer.ts";
import { SourceFile } from "./sources.ts";
import type { SourceMap } from "@texteda/ir/spans";
import { checkVersion, typeRange } from "./version.ts";
import { resolveParamColumns } from "./params.ts";
import type { ComponentResolver } from "./schematic.ts";

/** The two files a board's procurement state is written in. */
export type ProcurementRole = "primary" | "alternatives";

export const PROCUREMENT_ROLES: readonly ProcurementRole[] = ["primary", "alternatives"];

/** The `procurement` type exists since language 0.9 (teda.md §13). */
const VERSION_RANGE = typeRange("procurement");

/** The only section of a procurement file. */
export const PROCUREMENT_SECTIONS = ["selections"] as const;

/**
 * The reserved target of a selection row: the line needs nothing bought.
 *
 * It is not a device id — it is the statement that there is nothing to order for this line,
 * which is different from "nobody has ordered it yet" (ADR-0029 D4).
 */
export const NOT_REQUIRED = "not-required";
export type ProcurementSection = (typeof PROCUREMENT_SECTIONS)[number];

/**
 * A device id: bare, `[a-z][a-z0-9-]*` (teda.md §4.2, `common#/$defs/device_ref`).
 *
 * Every device a project reads is its own file under `assets/components/`; the `<lib>:<id>`
 * qualifier was withdrawn with the vendored library (ADR-0034), and a qualified id is reported as
 * `ref.library-qualified-id` rather than resolved.
 */

export interface ProcurementParseOptions {
  /** File name, relative to the project root. */
  file: string;
  /** The board this file belongs to, taken from the file name. */
  board: string;
  /** The role this position allows, taken from the directory the file is in. */
  role: ProcurementRole;
  /** The device table, to read the generic's parameter columns. */
  components?: ComponentResolver;
}

export interface ProcurementParseResult {
  ok: boolean;
  ir?: Procurement;
  diagnostics: Diagnostic[];
  /** IR path → span of the record that produced it (ADR-0004 D2). Never persisted. */
  sources?: SourceMap;
}

/** One selection row as it is written. */
export interface ProcurementSelectionRow {
  /** The generic device the line buys. */
  generic: string;
  /** The requirement's cells, in the order they are written. */
  paramCells: string[];
  /** The part that is bought, or null for a line that needs nothing bought. */
  part: string | null;
  /** The line the row is on. */
  line: number;
  /** The column the row starts at. */
  col: number;
}

/** The file as it is written, without the project around it. */
export interface ProcurementDocument {
  /** The language version of the file, in canonical form. */
  version: string;
  /** The board the file declares. */
  board: string;
  /** The role the file declares. */
  role: ProcurementRole;
  /** The selection rows. */
  selections: ProcurementSelectionRow[];
}

export interface ProcurementDocumentResult {
  ok: boolean;
  document?: ProcurementDocument;
  diagnostics: Diagnostic[];
}

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  /** The diagnostics, under the name the shared helpers use. */
  get items(): Diagnostic[] {
    return this.diagnostics;
  }

  /** The one way a diagnostic enters the list; the helpers below are the two severities. */
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
      /** The definition site of a reference, when it has one (ADR-0004 D5). */
      related?: DiagnosticLocation[];
    },
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      location: { file, line, col },
      ...(extra?.expected !== undefined ? { expected: extra.expected } : {}),
      ...(extra?.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra?.hint !== undefined ? { hint: extra.hint } : {}),
      ...(extra?.data !== undefined ? { data: extra.data } : {}),
      ...(extra?.related !== undefined ? { related: extra.related } : {}),
    });
  }

  error(
    file: string,
    line: number,
    col: number,
    code: DiagnosticCodeId,
    message: string,
    extra?: {
      expected?: string;
      actual?: string;
      hint?: string;
      data?: Record<string, string | number | boolean>;
      /** The definition site of a reference, when it has one (ADR-0004 D5). */
      related?: DiagnosticLocation[];
    },
  ): void {
    this.add("error", code, message, file, line, col, extra);
  }

  warning(
    file: string,
    line: number,
    col: number,
    code: DiagnosticCodeId,
    message: string,
    extra?: {
      expected?: string;
      actual?: string;
      hint?: string;
      data?: Record<string, string | number | boolean>;
      /** The definition site of a reference, when it has one (ADR-0004 D5). */
      related?: DiagnosticLocation[];
    },
  ): void {
    this.add("warning", code, message, file, line, col, extra);
  }

  get hasError(): boolean {
    return this.diagnostics.some((d) => d.severity === "error");
  }
}

/**
 * Read a procurement file on its own: the header, the role and the rows as they are written.
 *
 * The position checks (the board and the role the file declares against the position it is in)
 * are not here: they need the project, so the board-level parse makes them.
 */
export function parseProcurementDocument(
  text: string,
  options: { file: string },
): ProcurementDocumentResult {
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
  const verdict = checkVersion(versionLine.cells[1]!.text, VERSION_RANGE, "procurement");
  if (!verdict.ok) {
    collector.error(
      file,
      versionLine.number,
      versionLine.cells[1]!.col,
      verdict.code,
      verdict.message,
      verdict.hint ? { hint: verdict.hint } : undefined,
    );
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "procurement") {
    collector.error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be procurement <board_id>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const board = typeLine.cells[1]!.text;

  // The role is a header scalar: it says which of the two files this is.
  const roleLine = nextMeaningful();
  if (!roleLine || roleLine.cells.length !== 2 || roleLine.cells[0]!.text !== "role") {
    collector.error(file, roleLine?.number ?? 1, 1, "syntax.header-invalid", "the third line must be role <primary|alternatives>");
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const roleText = roleLine.cells[1]!.text;
  if (roleText !== "primary" && roleText !== "alternatives") {
    collector.error(
      file,
      roleLine.number,
      roleLine.cells[1]!.col,
      "format.role-invalid",
      `not a valid role: ${roleText}`,
      { expected: "primary or alternatives", actual: roleText },
    );
    return { ok: false, diagnostics: collector.diagnostics };
  }
  const role: ProcurementRole = roleText;

  const selections: ProcurementSelectionRow[] = [];
  let section: ProcurementSection | null = null;

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1) {
      const name = line.cells[0]!.text;
      if (name !== "selections") {
        collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-section", `unknown section: ${name}`);
        section = null;
        continue;
      }
      section = "selections";
      continue;
    }

    if (section !== "selections") {
      collector.error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${line.cells[0]!.text}`);
      continue;
    }

    // `<generic_id> <parameter_value…> -> <part_id>`: the arrow terminates the left side, because
    // the number of parameter columns is only known once the generic is resolved.
    const cells = line.cells;
    const arrows = cells.filter((cell) => cell.text === "->").length;
    const arrow = cells.findIndex((cell) => cell.text === "->");
    if (arrows !== 1 || arrow < 1 || arrow !== cells.length - 2) {
      collector.error(
        file,
        line.number,
        cells[0]!.col,
        "syntax.selection-invalid",
        "a selection row reads <generic_id> <parameter_value…> -> <part_id>",
        { expected: "one -> between the key and the part", actual: line.text },
      );
      continue;
    }

    const generic = cells[0]!.text;
    if (QUALIFIED_REF_RE.test(generic)) {
      collector.error(
        file,
        line.number,
        cells[0]!.col,
        "ref.library-qualified-id",
        `a device reference is qualified with a library name: ${generic}`,
        {
          expected: "a bare device id",
          actual: generic,
          hint: "import the device into assets/components/ (`texteda lib import`), then write its bare id (ADR-0034)",
        },
      );
      continue;
    }
    if (!DEVICE_ID_RE.test(generic)) {
      collector.error(file, line.number, cells[0]!.col, "syntax.invalid-token", `not a valid device id: ${generic}`);
      continue;
    }
    // The right side is a part id, or the reserved target `not-required`: the line needs
    // nothing bought (a part that is only there to be a test point, say).
    const target = cells[arrow + 1]!.text;
    const part = target === NOT_REQUIRED ? null : target;
    if (part !== null && QUALIFIED_REF_RE.test(part)) {
      collector.error(
        file,
        line.number,
        cells[arrow + 1]!.col,
        "ref.library-qualified-id",
        `a device reference is qualified with a library name: ${part}`,
        {
          expected: "a bare device id",
          actual: part,
          hint: "import the device into assets/components/ (`texteda lib import`), then write its bare id (ADR-0034)",
        },
      );
      continue;
    }
    if (part !== null && !DEVICE_ID_RE.test(part)) {
      collector.error(file, line.number, cells[arrow + 1]!.col, "syntax.invalid-token", `not a valid device id: ${part}`);
      continue;
    }

    selections.push({
      generic,
      paramCells: cells.slice(1, arrow).map((cell) => cell.text),
      part,
      line: line.number,
      col: cells[0]!.col,
    });
  }

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  return {
    ok: true,
    document: {
      version: verdict.ok ? verdict.text : "0.9",
      board,
      role,
      selections,
    },
    diagnostics: collector.diagnostics,
  };
}

/** The BOM line key: the generic and the values it was given. */
function lineKey(generic: string, params: Selection["params"]): string {
  return JSON.stringify([generic, params]);
}

/**
 * Parse a `procurement` description in the position it sits in.
 *
 * The board id comes from the file name and the role from the directory; the file states both, and
 * a file that disagrees with its position is an error — a selection in the wrong file would be
 * read as the wrong thing (normative instead of advisory).
 */
export function parseProcurement(text: string, options: ProcurementParseOptions): ProcurementParseResult {
  const { file } = options;
  const parsed = parseProcurementDocument(text, { file });
  if (!parsed.ok || !parsed.document) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }
  const document = parsed.document;
  const collector = new Collector();
  collector.diagnostics.push(...parsed.diagnostics);

  if (document.board !== options.board) {
    collector.error(
      file,
      2,
      1,
      "ref.board-id-mismatch",
      `the board id in the file header is ${document.board}, the file name says ${options.board}`,
      { expected: options.board, actual: document.board },
    );
  }
  if (document.role !== options.role) {
    collector.error(
      file,
      3,
      1,
      "format.role-invalid",
      `the file says role ${document.role}, but it is in the ${options.role} position`,
      { expected: options.role, actual: document.role },
    );
  }

  const selections: Selection[] = [];
  /**
   * Line of each selection, by object identity: the rows are sorted before they enter the IR, and a
   * line number is a function of the line order, so it stays beside the IR (ADR-0004 D1).
   */
  const at = new Map<object, number>();
  /** The lines already selected in the primary file: one per BOM line (spec/procurement.md §6). */
  const seen = new Map<string, number>();

  for (const row of document.selections) {
    const facts = options.components?.resolve(row.generic);
    if (!facts) {
      const broken = options.components?.broken?.(row.generic);
      if (broken !== undefined) {
        collector.warning(
          file,
          row.line,
          row.col,
          "ref.component-invalid",
          `generic ${row.generic} has errors in ${broken}`,
          { hint: `fix the errors reported for ${broken} first` },
        );
      } else {
        collector.error(
          file,
          row.line,
          row.col,
          "ref.unknown-generic",
          `generic ${row.generic} not found`,
          { expected: `assets/components/ contains ${row.generic}.teda` },
        );
      }
      continue;
    }

    const params = resolveParamColumns(
      facts.params,
      row.paramCells,
      {
        deviceId: row.generic,
        label: "generic",
        file,
        line: row.line,
        col: row.col,
        ...(facts.locate === undefined
          ? {}
          : { locateParam: (index: number) => facts.locate!(`/component/params/${index}`) }),
      },
      collector,
    );

    const key = lineKey(row.generic, params);
    if (options.role === "primary") {
      const first = seen.get(key);
      if (first !== undefined) {
        collector.error(
          file,
          row.line,
          row.col,
          "syntax.duplicate-key",
          `the line ${row.generic} is already selected on line ${first}`,
          { hint: "one BOM line has exactly one primary part; the other sources go in the alternatives file" },
        );
        continue;
      }
      seen.set(key, row.line);
    }

    const selection: Selection = {
      generic: row.generic,
      ...(params.length > 0 ? { params } : {}),
      ...(row.part === null ? { not_required: true as const } : { part: row.part }),
    };
    selections.push(selection);
    at.set(selection, row.line);
  }

  if (collector.hasError) return { ok: false, diagnostics: collector.diagnostics };

  // The IR orders the rows by the key, with the values compared numerically: a source file and its
  // IR may order two rows differently, which teda.md §12 rule 9 allows.
  selections.sort((a, b) => {
    if (a.generic !== b.generic) return a.generic < b.generic ? -1 : 1;
    const leftParams = a.params ?? [];
    const rightParams = b.params ?? [];
    const count = Math.min(leftParams.length, rightParams.length);
    for (let i = 0; i < count; i += 1) {
      const left = leftParams[i]!;
      const right = rightParams[i]!;
      if ("value" in left && "value" in right) {
        if (left.value !== right.value) return left.value < right.value ? -1 : 1;
        continue;
      }
      if ("text" in left && "text" in right) {
        if (left.text !== right.text) return left.text < right.text ? -1 : 1;
        continue;
      }
    }
    return leftParams.length - rightParams.length;
  });

  const ir: Procurement = {
    ir_version: irVersion,
    format: document.version,
    source: { file, line: 1 },
    procurement: {
      board: options.board,
      role: options.role,
      selections,
    },
  };
  const src = new SourceFile(file, lex(text));
  const sources: SourceMap = new Map();
  selections.forEach((selection, index) => sources.set(`/procurement/selections/${index}`, src.span(at.get(selection) ?? 1)));

  return { ok: true, ir, diagnostics: collector.diagnostics, sources };
}
