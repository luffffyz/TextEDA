// Runtime entry of the IR contract: the schema is the single source of truth, so this file validates
// the very same schema with Ajv; the types are generated from the schema (see scripts/generate.ts).
// No second validation implementation is introduced.
//
// Runtime-neutral: uses only Web standard APIs and Ajv — no Bun.*, no process.env, no file system.
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { schemas, schemaKinds, irVersion } from "./generated/schemas.ts";

export { irVersion, schemaKinds };
export type SchemaKind = (typeof schemaKinds)[number];

export * from "./diagnostics/index.ts";
export * from "./spans.ts";
import type { Diagnostic, DiagnosticLocation } from "./diagnostics/index.ts";

/** Schema-validation diagnostics: only an IR path, no file/line/column (the IR has no line numbers). */
export interface SchemaDiagnostic {
  /** JSON Pointer path; the empty string means the root. */
  path: string;
  keyword: string;
  message: string;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // The `anyOf: [{required:["rev"]},{required:["version"]}]` "at-least-one" idiom
  // makes Ajv falsely report required as not declared at the same level.
  strictRequired: false,
});

for (const schema of schemas) {
  ajv.addSchema(schema as AnySchema);
}

/** Compile on demand: CLI cold start need not compile all six schemas at once. */
const validators: Partial<Record<SchemaKind, ValidateFunction>> = {};

function validatorFor(kind: SchemaKind): ValidateFunction {
  const cached = validators[kind];
  if (cached) return cached;
  const compiled = ajv.getSchema(`urn:texteda:ir:${irVersion}:${kind}`);
  if (!compiled) throw new Error(`no schema for ${kind}`);
  validators[kind] = compiled;
  return compiled;
}

/** Validate one shard; the caller fills in line/column of the diagnostics (the IR carries no line numbers, only `source` pointers). */
export function validate(kind: SchemaKind, data: unknown): { ok: boolean; errors: SchemaDiagnostic[] } {
  const validateFn = validatorFor(kind);
  if (validateFn(data)) return { ok: true, errors: [] };
  const errors: SchemaDiagnostic[] = (validateFn.errors ?? []).map((e: ErrorObject) => ({
    path: e.instancePath,
    keyword: e.keyword,
    message: e.message ?? "is not valid",
  }));
  return { ok: false, errors };
}

/**
 * Map schema-validation errors onto unified diagnostics (ADR-0102).
 *
 * Third-party implementations using Ajv directly can also map to `contract.*` codes without
 * inventing their own scheme — the raw `cause` is preserved alongside.
 *
 * `locate` turns an IR path into the source location of the record that produced it (ADR-0103 D8):
 * schema errors otherwise name a JSON pointer, which its reader — who holds a `.teda` file — cannot
 * act on. Both points are kept when a locator is supplied: the location is what gets fixed, the
 * pointer says what the contract objects to.
 */
export function schemaDiagnosticsToDiagnostics(
  errors: readonly SchemaDiagnostic[],
  locate?: (irPath: string) => DiagnosticLocation | undefined,
): Diagnostic[] {
  return errors.map((e) => {
    const location = locate?.(e.path);
    return {
      code: e.keyword === "additionalProperties" ? "contract.unknown-field" : "contract.schema-violation",
      severity: "error",
      message: `${e.path === "" ? "/" : e.path} ${e.message}`,
      ...(location === undefined ? {} : { location }),
      cause: { source: "ajv", instancePath: e.path, keyword: e.keyword },
    };
  });
}
