// RS-274X writer: the board image, laid out as Gerber statements (ADR-0117 D4).
//
// This file owns digits and nothing else. No net, no clip, no kernel call, no clock, no randomness:
// a `BoardImage` in, text out. Every shape was decided by the assembler and the fill policy, so a
// change in this file can only change the *wording*, never the copper.
//
// Format decisions, frozen (ADR-0117 D9):
//   - `%FSLAX46Y46*%` with `%MOMM*%`: four integer digits and six decimals in millimetres, leading
//     zeros suppressed. One unit is therefore 1 nm (`0.000001 mm`), so a coordinate is written as
//     the nanometre count itself — no rescaling, no rounding, no float anywhere.
//   - `%LPD*%` (dark polarity) once in the header: this writer emits positive copper only.
//   - every statement ends with `*` and a LF; the file ends with exactly one LF after `M02*`.
//   - apertures are deduplicated, sorted, and numbered from `D10` in ascending diameter order, so a
//     D-code means the same thing in every export of the same board.
//   - a region is `G36*` / `G37*` with the ring **not repeated**: the first vertex moves with `D02`,
//     every following vertex draws with `D01`, and the last edge closes implicitly.
//   - statements are ordered by kind (regions, then draws, then flashes) and then by their canonical
//     geometry text, so the same image always produces the same bytes regardless of how it was built.
import type { Point, Polygon } from "@texteda/geom";
import type { BoardImage, DrawItem, FlashItem, ImageItem, ImageLayer, ManufacturingFile, ManufacturingStamp, RegionItem } from "@texteda/core/image";

/** Where a Gerber file's header starts, per layer: the file is named after the layer. */
const LAYER_SUFFIX = ".gbr";

/**
 * The first aperture D-code. `D01`–`D09` are reserved, so definitions begin at `D10` (RS-274X).
 */
const FIRST_APERTURE = 10;

/** Millimetres with `digits` decimals, from integer nanometres: never `toFixed`, never a float. */
export function decimal(nm: number, digits = 6): string {
  const unit = 10 ** (6 - digits); // nanometres per written unit: 1 nm at 6 decimals, 1 µm at 3
  const scaled = Math.round(nm / unit);
  const sign = scaled < 0 ? "-" : "";
  const magnitude = Math.abs(scaled);
  const divisor = 10 ** digits;
  const whole = Math.trunc(magnitude / divisor);
  const frac = magnitude % divisor;
  return `${sign}${whole}.${String(frac).padStart(digits, "0")}`;
}

/** A coordinate as the file spells it: the nanometre count, since one unit is 1 nm. */
function coordinate(nm: number): string {
  return String(nm === 0 ? 0 : nm);
}

function xy(point: Point): string {
  return `X${coordinate(point.x_nm)}Y${coordinate(point.y_nm)}`;
}

/**
 * A ring's canonical text: the ring is counter-clockwise and starts at its lexicographically smallest
 * vertex (the kernel's canonical form), so the text alone identifies the shape.
 */
function ringText(ring: Polygon): string {
  return ring.map((point) => `${coordinate(point.x_nm)},${coordinate(point.y_nm)}`).join(";");
}

function comparePoints(a: Point, b: Point): number {
  return a.x_nm === b.x_nm ? a.y_nm - b.y_nm : a.x_nm - b.x_nm;
}

/**
 * A polyline's points, reversed when the first point sorts after the last.
 *
 * A reversed polyline is the same stroke, so the writer is free to pick the direction — and it must,
 * or the same copper built from the other end would hash differently.
 */
function polylinePoints(points: Polygon): Polygon {
  if (points.length < 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return comparePoints(first, last) <= 0 ? points : [...points].reverse();
}

type Ordered = {
  /** Kind rank: regions, then draws, then flashes. */
  rank: number;
  /** The canonical geometry text, used to break ties within a kind. */
  text: string;
  /** The aperture this statement needs, if any. */
  diameter_nm: number | null;
  item: RegionItem | DrawItem | FlashItem;
};

function order(items: readonly ImageItem[]): Ordered[] {
  const out: Ordered[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "region":
        out.push({ rank: 0, text: `R|${ringText(item.shape)}`, diameter_nm: null, item });
        break;
      case "draw": {
        const points = polylinePoints(item.points);
        out.push({
          rank: 1,
          text: `D|${coordinate(item.width_nm)}|${points.map((point) => `${coordinate(point.x_nm)},${coordinate(point.y_nm)}`).join(";")}`,
          diameter_nm: item.width_nm,
          item: { kind: "draw", width_nm: item.width_nm, points },
        });
        break;
      }
      case "flash":
        out.push({
          rank: 2,
          text: `F|${coordinate(item.at.x_nm)},${coordinate(item.at.y_nm)},${coordinate(item.diameter_nm)}`,
          diameter_nm: item.diameter_nm,
          item,
        });
        break;
    }
  }
  return out.sort((a, b) => (a.rank === b.rank ? (a.text < b.text ? -1 : a.text > b.text ? 1 : 0) : a.rank - b.rank));
}

/** The distinct aperture diameters a layer needs, ascending. */
function apertures(entries: readonly Ordered[]): number[] {
  const diameters = new Set<number>();
  for (const entry of entries) if (entry.diameter_nm !== null && entry.diameter_nm > 0) diameters.add(entry.diameter_nm);
  return [...diameters].sort((a, b) => a - b);
}

/** One layer's complete Gerber file. An empty layer is a legal file: header, then `M02*`. */
export function gerberLayer(image: BoardImage, layer: ImageLayer, stamp: ManufacturingStamp): ManufacturingFile {
  const entries = order(layer.items);
  const diameters = apertures(entries);
  const codes = new Map<number, number>();
  diameters.forEach((diameter, index) => codes.set(diameter, FIRST_APERTURE + index));

  const lines: string[] = [];
  lines.push(`G04 TextEDA ${stamp.tool_version}*`);
  lines.push(`G04 source ${stamp.source_hash}*`);
  lines.push("%FSLAX46Y46*%");
  lines.push("%MOMM*%");
  lines.push("%LPD*%");
  for (const diameter of diameters) {
    lines.push(`%ADD${codes.get(diameter)}C,${decimal(diameter, 6)}*%`);
  }

  let current: number | null = null;
  for (const entry of entries) {
    if (entry.diameter_nm !== null) {
      const code = codes.get(entry.diameter_nm);
      if (code === undefined) continue; // A non-positive width: nothing to draw with.
      if (code !== current) {
        lines.push(`D${code}*`);
        current = code;
      }
    }
    if (entry.item.kind === "region") {
      lines.push("G36*");
      const ring = entry.item.shape;
      lines.push(`${xy(ring[0]!)}D02*`);
      for (let i = 1; i < ring.length; i += 1) lines.push(`${xy(ring[i]!)}D01*`);
      lines.push("G37*");
    } else if (entry.item.kind === "draw") {
      const points = entry.item.points;
      lines.push(`${xy(points[0]!)}D02*`);
      for (let i = 1; i < points.length; i += 1) lines.push(`${xy(points[i]!)}D01*`);
    } else {
      lines.push(`${xy(entry.item.at)}D03*`);
    }
  }
  lines.push("M02*");

  const name = `${image.board}-${layer.layer.replace(/\./g, "_")}${LAYER_SUFFIX}`;
  return { name, text: `${lines.join("\n")}\n` };
}

/**
 * Every Gerber file the image needs: one per layer it carries, including an empty one. A layer with
 * no copper still has to exist as a file, because a board house treats a missing layer as "not
 * defined" rather than "empty".
 */
export function toGerber(image: BoardImage, stamp: ManufacturingStamp): ManufacturingFile[] {
  return image.layers.map((layer) => gerberLayer(image, layer, stamp));
}
