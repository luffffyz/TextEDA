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
import { parseSymbol } from "@texteda/parser";
import { renderSymbol, toSvgText } from "../src/index.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const symbolFile = join(
  repoRoot,
  "examples/reference-project/assets/symbols/regulators/ldo-sot23-5.teda",
);

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
});
