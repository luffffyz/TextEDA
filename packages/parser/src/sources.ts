// Turning lexed lines into spans (ADR-0103).
//
// A span points at the first token of a record (D4) and never enters the IR (D1). Parsers record one
// span per IR record they emit; `check` uses the map to turn a schema violation — which only knows an
// IR path — into a file:line:col a reader can act on (D8).

import type { SourceMap, Span } from "@texteda/ir/spans";
import type { Cell, Line } from "./lexer.ts";

/** Span of a record that starts at `col` on `line`. The end is the end of the line's content. */
export function lineSpan(file: string, line: Line, col?: number): Span {
  const cell = col === undefined ? line.cells[0] : (line.cells.find((c) => c.col === col) ?? line.cells[0]);
  return {
    file,
    line: line.number,
    col: cell?.col ?? 1,
    byte: cell?.byte ?? line.byte,
    end: { line: line.number, col: line.end.col, byte: line.end.byte },
  };
}

/**
 * The lines of one file as the lexer produced them, addressable by line number. Parsers keep the raw
 * rows (line + column) and ask this for the span, so a record does not have to carry byte offsets.
 */
export class SourceFile {
  private readonly byNumber = new Map<number, Line>();

  constructor(
    readonly file: string,
    lines: readonly Line[],
  ) {
    for (const line of lines) this.byNumber.set(line.number, line);
  }

  /** Span of the record at `line`/`col`; an unknown line degrades to the bare numbers. */
  span(line: number, col = 1): Span {
    const lexed = this.byNumber.get(line);
    if (lexed === undefined) return { file: this.file, line, col, byte: 0 };
    return lineSpan(this.file, lexed, col);
  }

  /** Span of a whole line, ignoring where its first token sits. */
  lineSpan(line: number, cell?: Cell): Span {
    const lexed = this.byNumber.get(line);
    if (lexed === undefined) return { file: this.file, line, col: cell?.col ?? 1, byte: cell?.byte ?? 0 };
    return lineSpan(this.file, lexed, cell?.col);
  }
}

/** Record a span under an IR path. */
export function record(map: SourceMap, pointer: string, span: Span): void {
  map.set(pointer, span);
}

/**
 * Record `/base/<index>` for objects the parser registered a span for while building them.
 *
 * The IR arrays are canonically sorted, so the pointer index is the index in the shard; the parser
 * keeps the spans beside the unsorted records and asks for them once the order is final.
 */
export function recordObjects(map: SourceMap, base: string, items: readonly object[], spans: ReadonlyMap<object, Span>): void {
  items.forEach((item, index) => {
    const span = spans.get(item);
    if (span !== undefined) map.set(`${base}/${index}`, span);
  });
}

/** Record `/base/<index>` for each record, in the order the records ended up in the IR. */
export function recordAll<T>(map: SourceMap, base: string, records: readonly T[], spanOf: (record: T) => Span | undefined): void {
  records.forEach((record, index) => {
    const span = spanOf(record);
    if (span !== undefined) map.set(`${base}/${index}`, span);
  });
}
