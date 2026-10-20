// 行级词法：把一行切成单元格，并记住每格的起始列（诊断要行列定位）。
// 规则见 teda.md §3–§4：空白是分隔符，缩进不表达语义，注释只整行。

export interface Cell {
  text: string;
  /** 1 起始列。 */
  col: number;
}

export interface Line {
  /** 1 起始行号。 */
  number: number;
  /** 去掉首尾空白后的原文。 */
  text: string;
  cells: Cell[];
  blank: boolean;
  comment: boolean;
}

/** 切分一行；连续空白算一个分隔符。 */
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
