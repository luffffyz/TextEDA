// Line-level lexer: split a line into cells, remembering each cell's starting position (for diagnostic row/column positions).
// Rules: see spec/teda.md §3–§4: whitespace separates cells, indentation is not semantic, comments occupy a whole line.
//
// Positions follow ADR-0020 D3: `col` counts Unicode scalars (1-based), `byte` counts UTF-8 bytes from
// the start of the file (0-based). A file may hold `Ω`, `±` or Chinese text, so counting UTF-16 units
// would report a different column than an editor shows.

export interface Cell {
  text: string;
  /** 1-based column, counting Unicode scalars. */
  col: number;
  /** 0-based UTF-8 byte offset of the first character of the cell. */
  byte: number;
}

export interface Line {
  /** 1-based line number. */
  number: number;
  /** Original text with leading/trailing whitespace trimmed. */
  text: string;
  cells: Cell[];
  blank: boolean;
  comment: boolean;
  /** 0-based UTF-8 byte offset of the first byte of the line. */
  byte: number;
  /** Exclusive end of the line's content: the position just past its last character. */
  end: { col: number; byte: number };
}

const SCAN = /\S+/g;

/** UTF-8 byte length of one code point. */
function utf8Length(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** UTF-8 byte length of a string. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += utf8Length(ch.codePointAt(0)!);
  return bytes;
}

/** Split one line; consecutive whitespace counts as a single separator. `lineByte` is where the line starts. */
export function splitCells(text: string, lineByte = 0): Cell[] {
  const cells: Cell[] = [];
  let col = 1;
  let byte = lineByte;
  let offset = 0;
  SCAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCAN.exec(text)) !== null) {
    for (const ch of text.slice(offset, match.index)) {
      col += 1;
      byte += utf8Length(ch.codePointAt(0)!);
    }
    const token = match[0];
    let scalars = 0;
    let bytes = 0;
    for (const ch of token) {
      scalars += 1;
      bytes += utf8Length(ch.codePointAt(0)!);
    }
    cells.push({ text: token, col, byte });
    col += scalars;
    byte += bytes;
    offset = match.index + token.length;
  }
  return cells;
}

export function lexLine(text: string, number: number, lineByte = 0): Line {
  const trimmed = text.trim();
  const cells = splitCells(text, lineByte);
  // Trailing whitespace (including a CR from CRLF files) is not part of the line's content.
  const content = text.replace(/[ \t\r]+$/, "");
  let col = 1;
  let byte = lineByte;
  for (const ch of content) {
    col += 1;
    byte += utf8Length(ch.codePointAt(0)!);
  }
  return {
    number,
    text: trimmed,
    cells,
    blank: trimmed.length === 0,
    comment: trimmed.startsWith("#"),
    byte: lineByte,
    end: { col, byte },
  };
}

export function lex(text: string): Line[] {
  const lines: Line[] = [];
  let byte = 0;
  const parts = text.split("\n");
  for (let index = 0; index < parts.length; index += 1) {
    const raw = parts[index]!;
    lines.push(lexLine(raw, index + 1, byte));
    // The newline itself is one byte, and a CRLF file keeps its CR as part of the line's bytes.
    byte += utf8ByteLength(raw) + 1;
  }
  return lines;
}
