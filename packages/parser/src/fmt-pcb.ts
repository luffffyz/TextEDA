// Canonical form of the `pcb` description (`spec/pcb.md` §6).
//
// Invariants: `parse(fmt(x))` and `parse(x)` are semantically identical; `fmt(fmt(x)) == fmt(x)`.
// The approach is to **walk the source lines** instead of rebuilding from the IR: comments stay in place, only semantically meaningful columns and rows are rearranged.
import { lex } from "./lexer.ts";
import { parseAngleMdeg, parseLengthNm } from "./units.ts";
import { parseQuantity } from "./quantities.ts";
import { byteCompare } from "@texteda/ir/order";
import { PCB_SECTIONS, RULE_ORDER, normalizeRing, parsePcb } from "./pcb.ts";
import type { Diagnostic } from "@texteda/ir/diagnostics";

export interface PcbFormatResult {
  ok: boolean;
  /** The canonical text; not produced when there are semantic errors. */
  text?: string;
  diagnostics: Diagnostic[];
}

interface Row {
  /** The comments above this row. */
  comments: string[];
  cells: string[];
}

/** mm → source form: at most 4 decimal places, trailing zeros stripped. */
function mm(nm: number): string {
  const scaled = nm / 1e6;
  return Number.isInteger(scaled) ? String(scaled) : String(Number(scaled.toFixed(4)));
}

/** Ω: the impedance unit cannot be inferred from a prefix, so the canonical form keeps `Ω` (`spec/pcb.md` §6.3). */
function ohm(mohm: number): string {
  const scaled = mohm / 1000;
  const value = Number.isInteger(scaled) ? String(scaled) : String(Number(scaled.toFixed(4)));
  return `${value}Ω`;
}

/** Ratio/dielectric constant → source form (ppm conversion, integer arithmetic). */
function ratioText(ppm: number): string {
  const sign = ppm < 0 ? "-" : "";
  const value = Math.abs(ppm);
  const integer = Math.trunc(value / 1_000_000);
  const fraction = String(value % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return `${sign}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

/** Split a `[a,b,…]` cell into components; a non-tuple cell comes back as one component (callers degrade safely). */
function tupleParts(cell: string): string[] {
  const match = /^\[(.*)\]$/.exec(cell);
  return match === null ? [cell] : match[1]!.split(",");
}

/** One tuple cell with each component re-printed by `format` (ADR-0065: a tuple is one cell). */
function tuple(cell: string, format: (text: string) => string): string {
  return `[${tupleParts(cell).map(format).join(",")}]`;
}

/** Polyline direction normalization: reverse the whole polyline when the start sorts after the end (`spec/pcb.md` §6.2). */
function orient(points: string[]): string[] {
  const key = (cell: string) => {
    const [x, y] = tupleParts(cell);
    return Number(x) * 1e12 + Number(y);
  };
  if (points.length < 2) return points;
  const start = points[0]!;
  const last = points[points.length - 1]!;
  if (key(start) <= key(last)) return points;
  return [...points].reverse();
}

/** Column alignment: within the same section, align by the widest cell, at least two spaces between columns, no padding for the last column. */
function align(rows: string[][], indent = "  "): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    indent + row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index]!))).join("  "),
  );
}

/** Row scan: a section header is a **single-cell** row (`spec/pcb.md` §1); a `via` row inside `rules` is not treated as a header. */
function walk(text: string): { header: Row[]; scalars: Row[]; sections: { name: string; rows: Row[] }[]; trailing: string[] } {
  const header: Row[] = [];
  const scalars: Row[] = [];
  const sections: { name: string; rows: Row[] }[] = [];
  const trailing: string[] = [];
  let current: { name: string; rows: Row[] } | undefined;
  let pending: string[] = [];
  let seen = 0;

  for (const line of lex(text)) {
    if (line.blank) {
      pending = [];
      continue;
    }
    if (line.comment) {
      pending.push(line.text);
      continue;
    }
    const cells = line.cells.map((cell) => cell.text);
    const row: Row = { comments: pending, cells };
    pending = [];
    seen += 1;
    if (seen <= 2) {
      header.push(row);
      continue;
    }
    if (cells.length === 1 && PCB_SECTIONS.includes(cells[0] as never)) {
      current = { name: cells[0]!, rows: [] };
      sections.push(current);
      continue;
    }
    if (cells.length === 2 && cells[0] === "board_thickness") {
      current = undefined;
      scalars.push(row);
      continue;
    }
    (current?.rows ?? scalars).push(row);
  }
  trailing.push(...pending);
  return { header, scalars, sections, trailing };
}

/** Expand a group of aligned rows, carrying their comments along. */
function emit(rows: string[][], comments: (string[] | undefined)[], indent = "  "): string[] {
  const lines: string[] = [];
  rows.forEach((row, index) => {
    lines.push(...(comments[index] ?? []));
    lines.push(...align([row], indent));
  });
  return lines;
}

/** One cell → mm source form (bad values kept as-is; `formatPcb` only runs when parsing has no errors). */
function len(cell: string): string {
  const parsed = parseLengthNm(cell, "fmt", 1, 1, "mm", "value.invalid-value");
  return parsed.ok ? mm(parsed.value!) : cell;
}

function deg(cell: string): string {
  const parsed = parseAngleMdeg(cell, "fmt", 1, 1, "deg", "value.angle-invalid");
  if (!parsed.ok) return cell;
  const value = parsed.value / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

/** Pure ratio → ppm (integer arithmetic, same basis as the parser). */
function ratioPpmLocal(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (match === null) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 1_000_000 + Number((match[3] ?? "").padEnd(6, "0")));
}

/** Format a `pcb` description. Produces nothing when parsing has errors, to avoid "washing" a bad file into canonical form. */
export function formatPcb(text: string, options: { file: string }): PcbFormatResult {
  // The PCB id is taken from the type line: fmt cares about no filename/project context, only this one piece of text.
  const header = lex(text).filter((line) => !line.blank && !line.comment)[1];
  const pcb = header?.cells[1]?.text ?? "fmt";
  const parsed = parsePcb(text, { file: options.file, pcb });
  if (parsed.diagnostics.some((d) => d.severity === "error")) {
    return { ok: false, diagnostics: parsed.diagnostics };
  }

  const walked = walk(text);
  const lines: string[] = [];
  for (const row of walked.header) lines.push(...row.comments, row.cells.join(" "));

  if (walked.scalars.length > 0) {
    lines.push("");
    lines.push(...emit(walked.scalars.map((row) => [row.cells[0]!, len(row.cells[1]!)]), walked.scalars.map((row) => row.comments), ""));
  }

  for (const name of PCB_SECTIONS) {
    const blocks = walked.sections.filter((section) => section.name === name);
    if (blocks.length === 0) continue;
    lines.push("", name);
    lines.push(...sectionBody(name, blocks.flatMap((block) => block.rows)));
  }

  if (walked.trailing.length > 0) lines.push("", ...walked.trailing);
  return { ok: true, text: `${lines.join("\n").replace(/\n+$/, "")}\n`, diagnostics: [] };
}

/** The canonical content of one section (excluding the section header). */
function sectionBody(name: string, rows: Row[]): string[] {
  switch (name) {
    case "stackup": {
      // Stackup order is semantic: keep the source order, only normalize the values.
      const cells = rows.map((row) => {
        const [layer, kind, thickness, ...rest] = row.cells;
        if (kind === "dielectric") {
          const [material, er] = rest;
          return er === undefined
            ? [layer!, "dielectric", len(thickness!), material!]
            : [layer!, "dielectric", len(thickness!), material!, ratioText(ratioPpmLocal(er))];
        }
        return [layer!, "copper", len(thickness!), rest[0]!];
      });
      return align(cells);
    }
    case "outline": {
      const ring = normalizeRing(rows.map((row) => pointOf(row.cells[0]!)));
      return emit(
        ring.map((item) => [`[${mm(item.x_nm)},${mm(item.y_nm)}]`]),
        rows.map((row) => row.comments),
      );
    }
    case "place":
      return sortAndAlign(rows, (row) => row.cells[0]!, (cells) => [cells[0]!, point(cells[1]!), deg(cells[2]!), cells[3]!]);
    case "connect":
      return sortAndAlign(
        rows,
        (row) => [...row.cells].sort(byteCompare).join("|"),
        (cells) => [...cells].sort(byteCompare),
      );
    case "trace":
      return sortAndAlign(
        rows,
        (row, cells) => `${cells[0]}|${cells[1]}|${tupleParts(cells[3]!).join(",")}`,
        (cells) => [cells[0]!, cells[1]!, len(cells[2]!), ...orient(cells.slice(3).map((cell) => point(cell)))],
      );
    case "via":
      return sortAndAlign(
        rows,
        (row) => `${row.cells[0]}|${tupleParts(row.cells[1]!).join(",")}`,
        (cells) => [cells[0]!, point(cells[1]!), len(cells[2]!), len(cells[3]!), ...cells.slice(4)],
      );
    case "zone":
    case "keepout": {
      const cells = rows.map((row) => {
        const ring = normalizeRing(row.cells.slice(2).map((cell) => pointOf(cell)));
        return [...row.cells.slice(0, 2), ...ring.map((item) => `[${mm(item.x_nm)},${mm(item.y_nm)}]`)];
      });
      cells.sort((a, b) => byteCompare(a.join("|"), b.join("|")));
      return emit(cells, rows.map((row) => row.comments));
    }
    case "rules": {
      const cells = rows.map((row) => formatRule(row.cells));
      const sorted = cells
        .map((cells, index) => ({ cells, comments: rows[index]!.comments }))
        .sort((a, b) => {
          const order = RULE_ORDER.indexOf(a.cells[0]!) - RULE_ORDER.indexOf(b.cells[0]!);
          return order !== 0 ? order : byteCompare(a.cells.join("|"), b.cells.join("|"));
        });
      return emit(sorted.map((item) => item.cells), sorted.map((item) => item.comments));
    }
    case "silk":
      return sortAndAlign(
        rows,
        (row) => row.cells[0]!,
        (cells) => [cells[0]!, cells[1]!, len(cells[2]!), cells[3]!],
      );
    case "physical_only":
      return sortAndAlign(
        rows,
        (row) => row.cells[0]!,
        (cells) => [cells[0]!, cells[1]!, point(cells[2]!), ...cells.slice(3).map((cell) => len(cell))],
      );
    case "deviation":
      return sortAndAlign(rows, (row) => row.cells.join("|"), (cells) => cells);
  }
  return align(rows.map((row) => [...row.cells]));
}

/** Sort + normalize cells + column alignment; each comment follows its original row. */
function sortAndAlign(
  rows: Row[],
  key: (row: Row, cells: string[]) => string,
  normalize: (cells: string[]) => string[],
): string[] {
  const items = rows
    .map((row) => {
      const cells = normalize([...row.cells]);
      return { cells, comments: row.comments, key: key(row, cells) };
    })
    .sort((a, b) => byteCompare(a.key, b.key));
  return emit(
    items.map((item) => item.cells),
    items.map((item) => item.comments),
  );
}

/**
 * One `[x,y]` cell → a point; a non-tuple degrades to `(0,0)`, and bad values become 0 too
 * (`formatPcb` only runs when parsing has no errors).
 */
function pointOf(cell: string): { x_nm: number; y_nm: number } {
  const [rawX, rawY] = tupleParts(cell);
  const x = parseLengthNm(rawX ?? "", "fmt", 1, 1, "mm");
  const y = parseLengthNm(rawY ?? "", "fmt", 1, 1, "mm");
  return { x_nm: x.ok ? x.value! : 0, y_nm: y.ok ? y.value! : 0 };
}

/** One `[x,y]` cell → its canonical cell, each component in mm source form. */
function point(cell: string): string {
  const [rawX, rawY] = tupleParts(cell);
  return `[${len(rawX ?? "")},${len(rawY ?? "")}]`;
}

/** The canonical cells of one `rules` row. */
function formatRule(cells: string[]): string[] {
  const kind = cells[0]!;
  const out = [kind, ...cells.slice(1)];
  const lenAt = (index: number) => {
    out[index] = len(out[index]!);
  };
  switch (kind) {
    case "clearance":
    case "width":
    case "min_width":
      lenAt(1);
      break;
    case "via":
    case "thermal":
    case "mask":
      lenAt(1);
      if (kind !== "mask") lenAt(2);
      break;
    case "net":
      lenAt(2);
      lenAt(3);
      lenAt(4);
      lenAt(5);
      break;
    case "diff": {
      const impedance = parseQuantity(cells[3]!, "impedance", { code: "value.invalid-unit" });
      out[3] = impedance.ok ? ohm(impedance.value) : cells[3]!;
      lenAt(4);
      break;
    }
    case "match":
      lenAt(3);
      break;
    case "paste":
      out[1] = ratioText(ratioPpmLocal(cells[1]!));
      lenAt(2);
      break;
  }
  return out;
}
