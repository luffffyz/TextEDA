// The parameter columns of a device row.
//
// Two kinds of row carry them, and they carry them the same way: an `instances` row fills a
// device's declared `params` (teda.md §6.2), and a procurement selection row states the
// requirement of a generic (spec/procurement.md §3). The column order comes from the device's
// `params` section — it is the only place that order is written down — so both rows read it the
// same way, and they are read here once.
import { checkDeviceParamValue } from "@texteda/core";
import type { ParamValue } from "@texteda/ir/schematic";
import type { Diagnostic, DiagnosticCodeId, DiagnosticLocation } from "./diagnostics.ts";
import { PARAM_TYPE_KINDS, type ComponentParamDecl } from "./component.ts";
import { parseQuantity } from "./quantities.ts";

/** The collector the caller owns; the parser's own collector satisfies it. */
export interface ParamDiagnostics {
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
      /** The declaration site of the parameter, when the device file's map has one (ADR-0020 D5). */
      related?: DiagnosticLocation[];
    },
  ): void;
  readonly items: Diagnostic[];
}

/** What the messages need to know about the row being read. */
export interface ParamContext {
  /** The device the columns belong to (for the messages). */
  deviceId: string;
  /** How the device is called in the messages ("component", "generic", ...). */
  label: string;
  file: string;
  line: number;
  col: number;
  /** Where the device file declares parameter `index`, when that is known (ADR-0020 D5). */
  locateParam?: (index: number) => DiagnosticLocation | undefined;
}

/** The declaration a row was read against, wrapped for a diagnostic's `related` list. */
function declared(context: ParamContext, index: number): { related?: DiagnosticLocation[] } {
  const at = context.locateParam?.(index);
  return at === undefined ? {} : { related: [at] };
}

/**
 * Read a row's parameter columns against a device's declared parameters.
 *
 * The optional columns may be omitted from the right; a required one may not. A count that does
 * not match is an error and the row yields no parameters: a half-read row must not reach the IR.
 */
export function resolveParamColumns(
  decls: readonly ComponentParamDecl[],
  cells: readonly string[],
  context: ParamContext,
  diagnostics: ParamDiagnostics,
): ParamValue[] {
  const { deviceId, label, file, line, col } = context;
  const required = decls.filter((decl) => decl.required).length;
  if (cells.length > decls.length) {
    diagnostics.add(
      "error",
      "value.param-count-mismatch",
      `${label} ${deviceId} declares ${decls.length} parameters, but the row gives ${cells.length}`,
      file,
      line,
      col,
      { expected: `at most ${decls.length} columns`, actual: `${cells.length} columns`, ...declared(context, 0) },
    );
    return [];
  }
  if (cells.length < required) {
    diagnostics.add(
      "error",
      "value.param-count-mismatch",
      `${label} ${deviceId} has ${required} required parameters, but the row gives only ${cells.length}`,
      file,
      line,
      col,
      { expected: `at least ${required} columns`, actual: `${cells.length} columns`, ...declared(context, 0) },
    );
    return [];
  }

  const params: ParamValue[] = [];
  for (let i = 0; i < cells.length; i += 1) {
    const decl = decls[i]!;
    const text = cells[i]!;
    if (decl.type === "string") {
      // A code-valued role has a closed value set (ADR-0038 D5): the spelling is exact, because
      // two spellings of one code would be two BOM lines.
      diagnostics.items.push(
        ...checkDeviceParamValue(decl.name, text, { file, line, col }),
      );
      params.push({ name: decl.name, text });
      continue;
    }
    const kind = PARAM_TYPE_KINDS[decl.type];
    if (kind === undefined) {
      diagnostics.add(
        "error",
        "value.unknown-param-type",
        `parameter ${decl.name} of ${label} ${deviceId} declares unknown type ${decl.type}`,
        file,
        line,
        col,
        declared(context, i),
      );
      continue;
    }
    const parsed = parseQuantity(text, kind, { code: "value.invalid-param" });
    if (!parsed.ok) {
      diagnostics.add(
        "error",
        "value.invalid-param",
        `invalid value for parameter ${decl.name}: ${parsed.reason}`,
        file,
        line,
        col,
        { expected: `a value of type ${decl.type}`, actual: text, ...declared(context, i) },
      );
      continue;
    }
    params.push({ name: decl.name, value: parsed.value });
  }
  return params;
}
