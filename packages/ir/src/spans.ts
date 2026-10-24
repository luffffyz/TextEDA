// Source positions of IR records (ADR-0020).
//
// A span is where a record of a `.teda` file starts. It never enters the IR: the IR bytes depend on
// the semantics alone (AGENTS.md §10), and a line number is a function of the line order. The parser
// keeps the spans beside the IR and hands them to whoever turns a diagnostic into a located one.
//
// Shape fixed by ADR-0020 D3: `col` counts Unicode scalars (1-based), `byte` counts UTF-8 bytes
// (0-based), `end` is exclusive and optional.

export interface SpanEnd {
  line: number;
  col: number;
  byte: number;
}

export interface Span {
  /** Path relative to the project root, `/`-separated. */
  file: string;
  line: number;
  col: number;
  byte: number;
  end?: SpanEnd;
}

/**
 * IR path (RFC 6901 JSON Pointer) → span of the source record that produced it.
 *
 * Record level only (ADR-0020 D4): `/instances/3`, not `/instances/3/params/0`. A diagnostic deep
 * inside a record resolves to the record's span by longest prefix.
 */
export type SourceMap = Map<string, Span>;

/** The span for `pointer`, else the nearest enclosing record's span. */
export function spanOf(sourceMap: SourceMap, pointer: string): Span | undefined {
  let path = pointer;
  while (true) {
    const span = sourceMap.get(path);
    if (span !== undefined) return span;
    if (path === "") return undefined;
    const cut = path.lastIndexOf("/");
    path = cut === -1 ? "" : path.slice(0, cut);
  }
}
