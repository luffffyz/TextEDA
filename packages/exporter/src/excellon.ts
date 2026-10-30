// Excellon writer: the board image's drills as one NC drill file (ADR-0018 D4).
//
// Same contract as the Gerber writer: this file owns digits only. Hole positions and diameters are
// already decided by the assembler, so nothing here reads a pad, a net, or the kernel.
//
// Format decisions, frozen (ADR-0018 D9):
//   - one file, `<board>.drl`, covering plated and unplated holes alike: a board house accepts one
//     file, and a separate unplated file is a legacy convention this writer does not need;
//   - `M48` header, the tool's identity as `;` comments (Excellon's comment marker, not Gerber's
//     `G04`), then `FMAT,2` and `METRIC,TZ`: trailing-zero suppression **with an explicit decimal
//     point**, so a coordinate reads as the millimetres it means and no digit count has to be
//     assumed;
//   - coordinates are written from the exact nanometre value with trailing zeros dropped, keeping
//     one decimal digit (`13.0`, `25.2`, `0.000001`). Never rounded to a fixed digit count: the IR's
//     coordinates are integers and the file should say the same number (ADR-0006 decision 7);
//   - tool diameters are millimetres with exactly 6 decimals (a tool table entry is a fixed shape);
//   - tools are numbered from `T1` in ascending diameter order, so `T1` is always the smallest hole;
//   - holes are grouped by tool and sorted by `(x, y)`, never by the order the image produced them;
//   - `;unplated: <n>` states how many holes carry no plating, omitted when that count is zero;
//   - `M30` ends the file, after exactly one LF.
import type { BoardImage, DrillHit, ManufacturingFile, ManufacturingStamp } from "@texteda/core/image";

/**
 * A millimetre value with trailing zeros dropped, at least one decimal digit.
 *
 * `13.` and `13` mean different things to a drill file, so a whole millimetre value keeps its `.0`.
 */
export function drillDecimal(nm: number): string {
  const sign = nm < 0 ? "-" : "";
  const magnitude = Math.abs(nm);
  const whole = Math.trunc(magnitude / 1_000_000);
  const digits = String(magnitude % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${sign}${whole}.${digits.length === 0 ? "0" : digits}`;
}

/** Millimetres with exactly 6 decimals: a tool table entry is a fixed shape. */
function toolDiameter(nm: number): string {
  const whole = Math.trunc(nm / 1_000_000);
  const frac = String(nm % 1_000_000).padStart(6, "0");
  return `${whole}.${frac}`;
}

function compareHits(a: DrillHit, b: DrillHit): number {
  return a.x_nm === b.x_nm ? a.y_nm - b.y_nm : a.x_nm - b.x_nm;
}

/**
 * The drill file for a board image: one `ManufacturingFile`, or none when the board has no holes.
 *
 * A board with no holes gets no file rather than an empty one: an Excellon file with a header and no
 * tool is rejected by some board houses, and "this board has nothing to drill" is not a fact a file
 * should have to say.
 */
export function toExcellon(image: BoardImage, stamp: ManufacturingStamp): ManufacturingFile[] {
  const hits = image.drills.filter((hit) => hit.diameter_nm > 0);
  if (hits.length === 0) return [];
  const diameters = [...new Set(hits.map((hit) => hit.diameter_nm))].sort((a, b) => a - b);
  const tools = new Map<number, number>();
  diameters.forEach((diameter, index) => tools.set(diameter, index + 1));

  const lines: string[] = [];
  lines.push("M48");
  lines.push(`;TextEDA ${stamp.tool_version}`);
  lines.push(`;source ${stamp.source_hash}`);
  const unplated = hits.filter((hit) => !hit.plated).length;
  if (unplated > 0) lines.push(`;unplated: ${unplated}`);
  lines.push("FMAT,2");
  lines.push("METRIC,TZ");
  for (const diameter of diameters) lines.push(`T${tools.get(diameter)}C${toolDiameter(diameter)}`);
  lines.push("%");

  for (const diameter of diameters) {
    lines.push(`T${tools.get(diameter)}`);
    for (const hit of hits.filter((entry) => entry.diameter_nm === diameter).sort(compareHits)) {
      lines.push(`X${drillDecimal(hit.x_nm)}Y${drillDecimal(hit.y_nm)}`);
    }
  }
  lines.push("M30");

  return [{ name: `${image.board}.drl`, text: `${lines.join("\n")}\n` }];
}
