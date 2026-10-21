// Line-level lexer: split a line into cells, remembering each cell's starting column (for diagnostic row/column positions).
// Rules: see teda.md §3–§4: whitespace separates cells, indentation is not semantic, comments occupy a whole line.

export interface Cell {
  text: string;
  /** 1-based starting column. */
  col: number;
}

export interface Line {
  /** 1-based line number. */
  number: number;
  /** Original text with leading/trailing whitespace trimmed. */
  text: string;
  cells: Cell[];
  blank: boolean;
  comment: boolean;
}

/** Split one line; consecutive whitespace counts as a single separator. */
export function splitCells(text: string): Cell[] {
  const cells: Cell[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    cells.push({ text: m[0], col: m.index + 1 });
  }
  return cells;
}

export function lexLine(text: string, number: number): Line {
  const trimmed = text.trim();
  const cells = splitCells(text);
  return {
    number,
    text: trimmed,
    cells,
    blank: trimmed.length === 0,
    comment: trimmed.startsWith("#"),
  };
}

export function lex(text: string): Line[] {
  return text.split("\n").map((line, i) => lexLine(line, i + 1));
}
