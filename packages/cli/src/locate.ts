// Turning a schema violation's IR path into a source location (ADR-0020 D8).
//
// The parser hands back the span of every record it emitted; the contract validator knows only a
// JSON Pointer. A `contract.*` diagnostic keeps both: the location is what the reader fixes, the
// pointer says what the contract objects to.

import { spanOf, type SourceMap } from "@texteda/ir";
import type { DiagnosticLocation } from "@texteda/ir/diagnostics";

/** A locator for `schemaDiagnosticsToDiagnostics`, or `undefined` when no source map came with the parse. */
export function locateWith(
  sources: SourceMap | undefined,
): ((irPath: string) => DiagnosticLocation | undefined) | undefined {
  if (sources === undefined) return undefined;
  return (irPath) => spanOf(sources, irPath);
}

/**
 * A locator by identity: `id` → the span of the record carrying that id in `items` (an IR array that
 * the parser located under `base`). Used for the checks that name an instance or a net rather than a
 * JSON path, while the IR itself carries no line numbers (ADR-0020 D1).
 */
export function idLocator<T extends { id: string }>(
  sources: SourceMap | undefined,
  items: readonly T[],
  base: string,
): ((id: string) => DiagnosticLocation | undefined) | undefined {
  if (sources === undefined) return undefined;
  const byId = new Map<string, DiagnosticLocation>();
  items.forEach((item, index) => {
    const pointer = `${base}/${index}`;
    const span = spanOf(sources, pointer);
    if (span !== undefined) byId.set(item.id, span);
  });
  return (id) => byId.get(id);
}
