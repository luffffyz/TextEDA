// Through-hole pads sit on the wildcard layers `*.Cu` / `*.Mask` (spec/footprint.md §4): "every copper
// layer", not a layer literally named `*.Cu`. A preview has to draw such a pad; treating the wildcard as
// an unknown layer name made `styleOf` fall back to `fill: "none"`, so the pad body was drawn with
// neither fill nor stroke — a through-hole header previewed as an empty courtyard. The reference
// project has no through-hole footprint, so nothing caught it until a case used one.
import { describe, expect, test } from "bun:test";
import { parseFootprint } from "@texteda/parser";
import { renderFootprint, toSvgText } from "../src/index.ts";

const TH = `version 0.4.1
footprint hdr-1x1-254

attr through_hole
package_code 1x1-2.54

pads
  1  th  circle  0  0  1.7  1.7  drill=1
`;

const SMD = `version 0.4.1
footprint chip-0402

attr smd
package_code 0402

pads
  1  smd  roundrect  -0.5  0  0.6  0.6  rratio=0.25
`;

function svgOf(text: string): string {
  const parsed = parseFootprint(text, { file: "inline.teda", library: "project" });
  if (!parsed.ok || !parsed.ir) throw new Error("inline footprint did not parse");
  return toSvgText(renderFootprint(parsed.ir.footprint));
}

describe("wildcard layers", () => {
  test("a through-hole pad on `*.Cu` is drawn with copper fill, not as an invisible shape", () => {
    const svg = svgOf(TH);
    // The pad: outer ring in copper colour. A `fill="none" stroke="none"` circle would be this bug.
    expect(svg).toContain('<circle cx="0" cy="0" r="0.85" fill="#b45309" stroke="none"/>');
    expect(svg).not.toContain('r="0.85" fill="none" stroke="none"');
    // The drill is punched out of it, in the background colour.
    expect(svg).toContain('<circle cx="0" cy="0" r="0.5" fill="#ffffff" stroke="none"/>');
  });

  test("an SMD pad keeps drawing on its explicit `F.Cu`", () => {
    const svg = svgOf(SMD);
    expect(svg).toContain('rx="0.075" fill="#b45309" stroke="none"');
  });
});
