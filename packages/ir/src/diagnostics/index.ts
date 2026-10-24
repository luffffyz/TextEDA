// Shared shapes and utility functions for diagnostics (ADR-0016).
//
// Diagnostics are part of the product (AGENTS.md §12): every diagnostic must point to a file,
// line/column, expected/actual values and a fix hint, and must be consumable by agents (`--json`).
// Shapes live here instead of one copy per package so that diagnostics from every layer
// (parser / semantic checker / schema validation) serialize to callers with the same contract.
//
// The error-code form (`domain.slug`) and the registry are in `codes.ts`; the registry is the single source of truth.

import type { DiagnosticCodeId } from "./codes.ts";

export type {
  DiagnosticCodeEntry,
  DiagnosticCodeId,
  DiagnosticDomain,
  DiagnosticSeverity,
  DiagnosticStage,
} from "./codes.ts";
export {
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_CODE_IDS,
  DIAGNOSTIC_DOMAINS,
  DIAGNOSTIC_STAGES,
  STAGE_BY_DOMAIN,
  codeEntry,
  isDiagnosticCode,
  stageOf,
} from "./codes.ts";
import { codeEntry, stageOf } from "./codes.ts";
import type { DiagnosticStage } from "./codes.ts";

/**
 * The fix hint (`hint`) registered in the registry.
 *
 * This is the **fallback**: a call site may give a more specific wording (with context); if it does not,
 * use this one. The registry is the single source of truth, so `docs/error-codes.md` can list
 * "how to fix" for every code.
 */
export function hintFor(code: DiagnosticCodeId): string | undefined {
  return codeEntry(code).hint;
}

/** Severity. `error` blocks the export, `warning` only reports, `note` is informational. */
export type Severity = "error" | "warning" | "note";

/**
 * Location of a diagnostic: path of the file relative to the project root + 1-based line and column.
 *
 * `col` counts Unicode scalars (a `Ω` or `±` is one column, not two), `byte` is the 0-based UTF-8
 * offset of the same character. Both are carried because a human reads a column and a tool seeks a
 * byte (ADR-0020 D3). `end` is exclusive and optional: record-level diagnostics point at the first
 * token of the record and may give its end.
 */
export interface DiagnosticLocation {
  file: string;
  line: number;
  col: number;
  byte?: number;
  end?: { line: number; col: number; byte: number };
}

/** Raw cause of a diagnostic (machine-produced information such as schema validation). */
export interface DiagnosticCause {
  /** The tool or validator that produced this information, e.g. `ajv`. */
  source: string;
  /** Location as a JSON Pointer (inside the IR). */
  instancePath?: string;
  /** The validator keyword, e.g. `required`, `additionalProperties`. */
  keyword?: string;
}

/** One diagnostic. */
export interface Diagnostic {
  /** Error code: `domain.slug` (e.g. `net.pin-in-two-nets`). Guaranteed by the type to be in the registry. */
  code: DiagnosticCodeId;
  severity: Severity;
  /** One sentence for humans: what is wrong and where. */
  message: string;
  /** Location. Schema-level diagnostics have no source-file location (only an IR path, see `cause`). */
  location?: DiagnosticLocation;
  /** What was expected (optional). */
  expected?: string;
  /** What actually is (optional). */
  actual?: string;
  /** How to fix (optional). */
  hint?: string;
  /** Machine-usable structured fields (optional): field names are stable, agents branch on them. */
  data?: Record<string, string | number | boolean>;
  /** Related locations (optional): other occurrences of the same problem. */
  related?: DiagnosticLocation[];
  /** Raw cause (optional). */
  cause?: DiagnosticCause;
}

/** Human-readable one line: `file:line:col: severity code: message`. Without a location, just `severity code: message`. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.location ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: ` : "";
  return `${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

/** JSON payload of a list of diagnostics: for agent consumption. */
export interface DiagnosticsPayload {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  noteCount: number;
  /** Counts by stage (all three keys always present, so agents can read them reliably). */
  countsByStage: Record<DiagnosticStage, number>;
}

/** Arrange a list of diagnostics into a JSON payload (default fields are omitted, never null). */
export function diagnosticsToPayload(diagnostics: readonly Diagnostic[]): DiagnosticsPayload {
  return {
    diagnostics: diagnostics.map((d) => {
      // Fix hint: the call site's is more specific; if absent, use the registry's (ADR-0016).
      const hint = d.hint ?? hintFor(d.code);
      return {
        ...d,
        ...(d.location === undefined ? {} : { location: d.location }),
        ...(d.expected === undefined ? {} : { expected: d.expected }),
        ...(d.actual === undefined ? {} : { actual: d.actual }),
        ...(hint === undefined ? {} : { hint }),
        ...(d.data === undefined ? {} : { data: d.data }),
        ...(d.related === undefined ? {} : { related: d.related }),
        ...(d.cause === undefined ? {} : { cause: d.cause }),
      };
    }),
    countsByStage: countByStage(diagnostics),
    errorCount: diagnostics.filter((d) => d.severity === "error").length,
    warningCount: diagnostics.filter((d) => d.severity === "warning").length,
    noteCount: diagnostics.filter((d) => d.severity === "note").length,
  };
}

/** Count by stage; all three keys are always present. */
export function countByStage(
  diagnostics: readonly Diagnostic[],
): Record<DiagnosticStage, number> {
  const counts: Record<DiagnosticStage, number> = { parse: 0, contract: 0, semantic: 0 };
  for (const diagnostic of diagnostics) counts[stageOf(diagnostic.code)] += 1;
  return counts;
}
