// Coordinate tuples: one bracketed cell holds one geometric value (spec/teda.md §4.3, ADR-0065).
//
// A tuple is written `[a,b]` or `[a,b,c]` with no whitespace inside, and **its arity is fixed by the
// column that reads it** — never inferred from the row. This module is the one place that splits a
// bracketed cell back into components, so every describing type (view, pcb, symbol, footprint) reports
// the same thing for the same mistake: brackets missing, wrong arity, or whitespace inside.
//
// Components keep their own columns: a diagnostic about one coordinate (off the 0.01 mm grid, outside
// the sheet) points at that component while the tuple stays the unit of alignment (ADR-0065 D4).
import type { Cell } from "./lexer.ts";
import type { Diagnostic, DiagnosticCodeId } from "./diagnostics.ts";

/** A reader's way of recording a diagnostic; each parser already has one, so this module stays free of them. */
export type DiagnosticSink = (diagnostic: Diagnostic) => void;

/** Naming a tuple for diagnostics: `point` → "a point is `[x,y]`". */
export interface TupleShape {
  /** The noun used in messages, e.g. `point`, `size`, `offset`. */
  noun: string;
  /** The components' names, in order, e.g. `["x", "y"]` — they drive both the shape text and the messages. */
  components: readonly string[];
  /**
   * Set for a shape whose component count is open (`poly`, a wire's bends): `components` is then the
   * repeating unit (`["x","y"]`, or `["x","y","r"]` for a circle) and any whole multiple is accepted.
   * Unset means the count must be exactly `components.length`.
   */
  repeating?: boolean;
}

export const POINT: TupleShape = { noun: "point", components: ["x", "y"] };
export const SIZE: TupleShape = { noun: "size", components: ["w", "h"] };
export const OFFSET_3D: TupleShape = { noun: "offset", components: ["x", "y", "z"] };

/** The canonical spelling of a shape, e.g. "`[x,y]`". */
export function tupleShapeText(shape: TupleShape): string {
  const body = shape.components.join(",");
  return shape.repeating === true ? `[${body},…]` : `[${body}]`;
}

const BRACKET_RE = /^\[(.*)\]$/;

/**
 * Split one bracketed cell into its components, re-based onto the cell's own column.
 *
 * Returns `null` after pushing exactly one diagnostic when the cell is not a tuple of the right arity:
 * brackets missing, whitespace inside, an empty component, or the wrong number of components.
 * The components carry their own `col` offsets, so a later per-component diagnostic lands on the
 * component it is about.
 */
export function readTupleCells(
  cell: Cell,
  shape: TupleShape,
  file: string,
  line: number,
  sink: DiagnosticSink,
  code: DiagnosticCodeId = "syntax.invalid-literal",
): Cell[] | null {
  const expected = tupleShapeText(shape);
  const match = BRACKET_RE.exec(cell.text);
  if (match === null) {
    sink({
      code,
      severity: "error",
      message: `a ${shape.noun} is written ${expected} as one cell: ${cell.text}`,
      location: { file, line, col: cell.col },
      expected,
      actual: cell.text,
      hint: `write the components between brackets with no spaces inside, e.g. ${expected}`,
    });
    return null;
  }
  const body = match[1]!;
  if (/\s/.test(body)) {
    sink({
      code,
      severity: "error",
      message: `a ${shape.noun} has no spaces inside its brackets: ${cell.text}`,
      location: { file, line, col: cell.col },
      expected,
      actual: cell.text,
      hint: "a tuple is one cell, so the components cannot be separated by whitespace",
    });
    return null;
  }
  if (body.length === 0) {
    sink({
      code,
      severity: "error",
      message: `a ${shape.noun} needs its components: ${cell.text}`,
      location: { file, line, col: cell.col },
      expected,
      actual: cell.text,
    });
    return null;
  }
  const parts = body.split(",");
  const unit = shape.components.length;
  const wrong = shape.repeating === true ? parts.length % unit !== 0 : parts.length !== unit;
  if (wrong) {
    const wanted = shape.repeating === true ? `a whole multiple of ${unit}` : String(unit);
    sink({
      code,
      severity: "error",
      message: `a ${shape.noun} is ${expected}: ${parts.length} component(s) where ${wanted} are required`,
      location: { file, line, col: cell.col },
      expected,
      actual: cell.text,
      hint: shape.repeating === true ? `repeat the ${shape.components.join(", ")} group` : `write exactly ${shape.components.join(", ")}`,
    });
    return null;
  }
  const cells: Cell[] = [];
  let cursor = cell.col + 1; // the opening bracket
  for (const [index, part] of parts.entries()) {
    if (part.length === 0) {
      const name = shape.components[index % unit] ?? `component ${index + 1}`;
      sink({
        code,
        severity: "error",
        message: `a ${shape.noun} needs its ${name} component: ${cell.text}`,
        location: { file, line, col: cursor - 1 },
        expected,
        actual: cell.text,
      });
      return null;
    }
    cells.push({ text: part, col: cursor, byte: cell.byte });
    cursor += part.length + 1; // the comma that follows
  }
  return cells;
}

/** The same split for a `key=value` payload that is not its own cell: `at=[-6.5,20]`. */
export function readTupleText(
  text: string,
  col: number,
  shape: TupleShape,
  file: string,
  line: number,
  sink: DiagnosticSink,
  code: DiagnosticCodeId = "syntax.invalid-literal",
): Cell[] | null {
  return readTupleCells({ text, col, byte: 0 }, shape, file, line, sink, code);
}

/** A shape whose geometry is one cell mixing points and scalars: `rect [x,y,x,y]`, `circle [cx,cy,r]`. */
export function shapeFor(noun: string, components: string[], repeating = false): TupleShape {
  return { noun, components, ...(repeating ? { repeating: true } : {}) };
}

