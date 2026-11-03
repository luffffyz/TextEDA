// The typography contract: glyphs are drawn as **paths**, never relying on system fonts.
//
// If this layer ever falls back to `<text>`, previews on machines without the font
// would degrade to shapes only -- so "no <text> elements" is a hard constraint, not an implementation detail.
// The layout itself lives in `packages/core` (the board image strokes silkscreen with the same font);
// this file only checks that the renderer's SVG output uses it instead of `<text>`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSymbol, readComponentFacts } from "@texteda/parser";
import { renderSymbol, toSvgText } from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const symbolFile = join(
  repoRoot,
  "examples/reference-project/assets/symbols/regulators/ldo-sot23-5.teda",
);
const productionSymbolFile = join(
  repoRoot,
  "examples/reference-project/assets/symbols/power/bq24610rger.teda",
);
const productionComponentFile = join(
  repoRoot,
  "examples/reference-project/assets/components/power/bq24610rger.teda",
);

interface PaintedBounds {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function serializedPathBounds(pathData: string, strokeWidthMm: string): PaintedBounds {
  const coordinates = [...pathData.matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map((match) => Number(match[0]) * 1_000_000);
  const xs = coordinates.filter((_, index) => index % 2 === 0);
  const ys = coordinates.filter((_, index) => index % 2 === 1);
  const halfStroke = Number(strokeWidthMm) * 500_000;
  return {
    left: Math.min(...xs) - halfStroke,
    right: Math.max(...xs) + halfStroke,
    bottom: -Math.max(...ys) - halfStroke,
    top: -Math.min(...ys) + halfStroke,
  };
}
describe("SVG output does not depend on system fonts", () => {
  test("no <text> elements: text is drawn as paths", () => {
    const parsed = parseSymbol(readFileSync(symbolFile, "utf8"), {
      file: symbolFile,
      library: "project",
    });
    if (!parsed.ok || !parsed.ir) throw new Error("failed to parse reference symbol");
    const sym = parsed.ir.symbol;
    const doc = renderSymbol(sym, {
      pins: sym.pins.map((p) => ({ number: p.number, name: "IN", type: "input" })),
    });
    const svg = toSvgText(doc);
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("font-family");
    // The text is still on the drawing (paths plus a searchable title).
    expect(svg).toContain("<path d=");
    expect(svg).toContain("<title>IN</title>");
  });

  test("production pin-name paths keep 0.40 mm from the inner body frame", () => {
    const parsed = parseSymbol(readFileSync(productionSymbolFile, "utf8"), {
      file: productionSymbolFile,
      library: "power",
    });
    const facts = readComponentFacts(readFileSync(productionComponentFile, "utf8"), {
      file: productionComponentFile,
    });
    if (!parsed.ok || !parsed.ir || !facts.ok || !facts.facts) {
      throw new Error("failed to parse production symbol fixture");
    }
    const symbol = parsed.ir.symbol;
    const body = symbol.body?.find((item) => item.kind === "rect");
    if (!body || body.kind !== "rect" || body.start === undefined || body.end === undefined || body.width_nm === undefined) {
      throw new Error("production symbol body is not a rectangle");
    }
    const halfBodyStroke = body.width_nm / 2;
    const innerMinX = Math.min(body.start.x_nm, body.end.x_nm) + halfBodyStroke;
    const innerMaxX = Math.max(body.start.x_nm, body.end.x_nm) - halfBodyStroke;
    const innerMinY = Math.min(body.start.y_nm, body.end.y_nm) + halfBodyStroke;
    const innerMaxY = Math.max(body.start.y_nm, body.end.y_nm) - halfBodyStroke;
    const doc = renderSymbol(symbol, facts.facts);
    const svg = toSvgText(doc);
    const groups = [...svg.matchAll(/<g><title>([^<]*)<\/title>\s*<path d="([^"]+)"[^>]*stroke-width="([^"]+)"/g)];
    const labels = doc.primitives.filter((primitive) => primitive.kind === "text" && primitive.role === "pinName");
    const names = new Set(labels.map((label) => label.kind === "text" ? label.text : ""));
    for (const label of labels) {
      if (label.kind !== "text" || label.pin === undefined) throw new Error("production pin-name label missing");
      const pin = symbol.pins.find((candidate) => candidate.number === label.pin)!;
      const vertical = (pin.at.rotation_mdeg ?? 0) % 180_000 !== 0;
      expect(label.rotateMdeg).toBe(vertical ? 90_000 : undefined);
    }
    for (const label of labels) {
      if (label.kind !== "text" || label.pin === undefined) throw new Error("production pin-name label missing");
      const group = groups.find((candidate) => candidate[1] === label.text);
      if (!group) throw new Error(`serialized path missing for ${label.text}`);
      const pathData = group[2];
      const strokeWidth = group[3];
      if (pathData === undefined || strokeWidth === undefined) throw new Error(`serialized path is incomplete for ${label.text}`);
      const bounds = serializedPathBounds(pathData, strokeWidth);
      const pin = symbol.pins.find((candidate) => candidate.number === label.pin)!;
      const gap = pin.at.rotation_mdeg === 0
        ? bounds.left - innerMinX
        : pin.at.rotation_mdeg === 180_000
          ? innerMaxX - bounds.right
          : pin.at.rotation_mdeg === 90_000
            ? bounds.bottom - innerMinY
            : innerMaxY - bounds.top;
      expect(Math.round(gap)).toBe(400_000);
    }
  });
});
