import { strokeWidthFor, textStrokes } from "@texteda/core/font";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { arcGeometry, type SvgPrimitive, type SvgText } from "./svg.ts";

type FieldOverride = NonNullable<SchematicView["field"]>[number];

const FIELD_CLEARANCE_NM = 1_000_000;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ResolvedField {
  x: number;
  y: number;
  text: string;
}

function selectedUnit(primitive: SvgPrimitive, unit: number): boolean {
  const drawn = primitive.kind === "pad" ? 1 : (primitive.unit ?? 1);
  return drawn === 0 || drawn === unit;
}

function includeArcBounds(
  include: (x: number, y: number, margin: number) => void,
  p: Extract<SvgPrimitive, { kind: "arc" }>,
  margin: number,
): void {
  include(p.x1, p.y1, margin);
  include(p.x2, p.y2, margin);
  const arc = arcGeometry(p.x1, p.y1, p.xm, p.ym, p.x2, p.y2);
  if (!arc) return;
  include(p.xm, p.ym, margin);

  const d = 2 * (p.x1 * (p.ym - p.y2) + p.xm * (p.y2 - p.y1) + p.x2 * (p.y1 - p.ym));
  const s1 = p.x1 * p.x1 + p.y1 * p.y1;
  const s2 = p.xm * p.xm + p.ym * p.ym;
  const s3 = p.x2 * p.x2 + p.y2 * p.y2;
  const cx = (s1 * (p.ym - p.y2) + s2 * (p.y2 - p.y1) + s3 * (p.y1 - p.ym)) / d;
  const cy = (s1 * (p.x2 - p.xm) + s2 * (p.x1 - p.x2) + s3 * (p.xm - p.x1)) / d;
  const start = Math.atan2(p.y1 - cy, p.x1 - cx);
  const end = Math.atan2(p.y2 - cy, p.x2 - cx);
  const twoPi = 2 * Math.PI;
  const norm = (angle: number): number => ((angle % twoPi) + twoPi) % twoPi;
  const forward = norm(end - start);
  const span = arc.sweep === 1 ? forward : twoPi - forward;
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const angle = quadrant * Math.PI / 2;
    const delta = arc.sweep === 1 ? norm(angle - start) : norm(start - angle);
    if (delta <= span + 1e-12) {
      include(cx + arc.radiusNm * Math.cos(angle), cy + arc.radiusNm * Math.sin(angle), margin);
    }
  }
}

/** Painted outer bounds of only the visible body units, rounded outward to whole nanometres. */
function bodyBounds(primitives: readonly SvgPrimitive[], unit: number): Bounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number, margin: number): void => {
    minX = Math.min(minX, x - margin);
    minY = Math.min(minY, y - margin);
    maxX = Math.max(maxX, x + margin);
    maxY = Math.max(maxY, y + margin);
  };
  for (const p of primitives) {
    if (p.kind === "text" || p.kind === "pin" || p.kind === "pad") continue;
    if (p.layer !== "symbol" || !selectedUnit(p, unit)) continue;
    if (p.kind === "arc") {
      if (p.widthNm > 0) includeArcBounds(include, p, p.widthNm / 2);
      continue;
    }
    const filled = p.kind !== "line" && p.fill !== "none";
    if (p.widthNm <= 0 && !filled) continue;
    const margin = p.widthNm > 0 ? p.widthNm / 2 : 0;
    switch (p.kind) {
      case "line":
        include(p.x1, p.y1, margin);
        include(p.x2, p.y2, margin);
        break;
      case "rect":
        include(p.x1, p.y1, margin);
        include(p.x2, p.y2, margin);
        break;
      case "circle":
        include(p.cx - p.rNm, p.cy - p.rNm, margin);
        include(p.cx + p.rNm, p.cy + p.rNm, margin);
        break;
      case "poly":
      case "polyline":
        for (const point of p.points) include(point.x, point.y, margin);
        break;
    }
  }

  if (!Number.isFinite(minX)) return undefined;
  return {
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    maxX: Math.ceil(maxX),
    maxY: Math.ceil(maxY),
  };
}

function rotatedTextPoint(x: number, y: number, rotationMdeg: number): { x: number; y: number } {
  const rotation = ((rotationMdeg % 360_000) + 360_000) % 360_000;
  if (rotation === 0) return { x, y };
  const radians = (rotation * Math.PI) / 180_000;
  return {
    x: Math.round(x * Math.cos(radians) - y * Math.sin(radians)),
    y: Math.round(x * Math.sin(radians) + y * Math.cos(radians)),
  };
}

/** Painted text ink bounds relative to a symbol-local field anchor. */
function fieldInkBounds(field: SvgText, text: string, anchor = field.anchor): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const rotation = field.rotateMdeg ?? 0;
  for (const stroke of textStrokes(text, {
    x: 0,
    y: 0,
    sizeNm: field.sizeNm,
    anchor,
    yDown: false,
  })) {
    for (const point of stroke.points) {
      const rotated = rotatedTextPoint(point.x, point.y, rotation);
      minX = Math.min(minX, rotated.x);
      minY = Math.min(minY, rotated.y);
      maxX = Math.max(maxX, rotated.x);
      maxY = Math.max(maxY, rotated.y);
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const halfStroke = strokeWidthFor(field.sizeNm) / 2;
  return {
    minX: minX - halfStroke,
    minY: minY - halfStroke,
    maxX: maxX + halfStroke,
    maxY: maxY + halfStroke,
  };
}

/** Resolve the text and symbol-local anchor of each instance field without mutating symbol facts. */
export function resolveSchematicFields(
  primitives: readonly SvgPrimitive[],
  instanceId: string,
  unit: number,
  value: string | undefined,
  overrides: readonly FieldOverride[] | undefined,
  rotationMdeg = 0,
): ReadonlyMap<SvgText, ResolvedField> {
  const visibleBody = bodyBounds(primitives, unit);
  const rotation = ((rotationMdeg % 360_000) + 360_000) % 360_000;
  const overridesByName = new Map<string, FieldOverride>();
  for (const override of overrides ?? []) {
    if (override.instance_id === instanceId) overridesByName.set(override.name, override);
  }
  const fields = new Map<SvgText, ResolvedField>();
  for (const primitive of primitives) {
    if (primitive.kind !== "text" || primitive.role !== "field") continue;
    const name = primitive.name;
    const text = name === "Reference" ? instanceId : name === "Value" && value !== undefined ? value : primitive.text;
    const manual = name === undefined ? undefined : overridesByName.get(name);
    let x = primitive.x;
    let y = primitive.y;
    if (manual) {
      x = manual.x_nm;
      y = manual.y_nm;
    } else if (visibleBody && (name === "Reference" || name === "Value")) {
      x = 0;
      if (rotation === 90_000 || rotation === 270_000) {
        const reference = name === "Reference";
        const onRight = rotation === 90_000 ? reference : !reference;
        const ink = fieldInkBounds(primitive, text, onRight ? "start" : "end");
        // Quarter-turned fields stay horizontal. Measure the final side-facing anchor so the font
        // height used for upright fields does not become extra sideways clearance.
        y = rotation === 90_000
          ? reference
            ? visibleBody.maxY + FIELD_CLEARANCE_NM - ink.minX
            : visibleBody.minY - FIELD_CLEARANCE_NM - ink.maxX
          : reference
            ? visibleBody.maxY + FIELD_CLEARANCE_NM + ink.maxX
            : visibleBody.minY - FIELD_CLEARANCE_NM + ink.minX;
      } else {
        const ink = fieldInkBounds(primitive, text);
        y = name === "Reference"
          ? visibleBody.maxY + FIELD_CLEARANCE_NM - ink.minY
          : visibleBody.minY - FIELD_CLEARANCE_NM - ink.maxY;
      }
    }
    fields.set(primitive, { x, y, text });
  }
  return fields;
}

export type { ResolvedField as ResolvedSchematicField };
