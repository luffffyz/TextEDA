// Unit tests for the footprint exporter: no KiCad dependency, only the generated S-expression text is checked.
// End-to-end behavior (KiCad reads it, DRC is clean, Gerbers come out) is covered by scripts/smoke-footprint.ts.
import { describe, expect, test } from "bun:test";
import { deriveUuid, deg, footprintInline, footprintModule, mm, type FootprintBody } from "../src/footprint.ts";

const thruHolePad: FootprintBody["pads"][number] = {
  number: "2",
  type: "th",
  shape: "circle",
  at: { x_nm: 1000000, y_nm: 0 },
  size: { x_nm: 1600000, y_nm: 1600000 },
  drill: { x_nm: 1000000, y_nm: 1000000 },
  layers: ["*.Cu", "*.Mask"],
};

const fp: FootprintBody = {
  library: "project",
  name: "demo-part",
  description: "example",
  tags: ["tag-a", "tag-b"],
  pads: [
    {
      number: "1",
      type: "smd",
      shape: "roundrect",
      at: { x_nm: -950000, y_nm: 950000 },
      size: { x_nm: 1100000, y_nm: 600000 },
      layers: ["F.Cu", "F.Mask", "F.Paste"],
      roundrect_ratio_ppm: 250000,
    },
    thruHolePad,
  ],
  graphics: [
    {
      kind: "rect",
      layer: "F.CrtYd",
      start: { x_nm: -1650000, y_nm: -1200000 },
      end: { x_nm: 1650000, y_nm: 1200000 },
      width_nm: 50000,
    },
  ],
  fields: [
    { name: "Reference", value: "REF**", at: { x_nm: 0, y_nm: -2000000 }, layer: "F.SilkS" },
    { name: "Value", value: "demo", at: { x_nm: 0, y_nm: 2000000 }, layer: "F.Fab" },
  ],
};

describe("Unit conversion", () => {
  test("nanometers convert to millimeters with trailing zeros removed", () => {
    expect(mm(510000)).toBe("0.51");
    expect(mm(0)).toBe("0");
    expect(mm(1)).toBe("0.000001");
    expect(mm(-500000)).toBe("-0.5");
  });

  test("millidegrees convert to degrees", () => {
    expect(deg(90000)).toBe("90");
    expect(deg(0)).toBe("0");
  });
});

describe("Library file", () => {
  const out = footprintModule(fp);

  test("tags must be one quoted string (multiple strings make KiCad refuse to load the library)", () => {
    expect(out).toContain('(tags "tag-a tag-b")');
    expect(out).not.toContain('"tag-a" "tag-b"');
  });

  test("pads, layers, geometry, and attributes are all present", () => {
    expect(out).toContain(
      '(pad "1" smd roundrect (at -0.95 0.95) (size 1.1 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))',
    );
    expect(out).toContain(
      '(pad "2" thru_hole circle (at 1 0) (size 1.6 1.6) (drill 1) (layers "*.Cu" "*.Mask"))',
    );
    expect(out).toContain(
      '(fp_rect (start -1.65 -1.2) (end 1.65 1.2) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))',
    );
    expect(out).toContain('(property "Reference" "REF**" (at 0 -2) (layer "F.SilkS")');
    expect(out).toContain("(attr smd)");
  });

  test("oblong through-hole drill writes oval", () => {
    const oval = footprintModule({
      ...fp,
      pads: [fp.pads[0], { ...thruHolePad, drill: { x_nm: 700000, y_nm: 2500000 } }],
    });
    expect(oval).toContain("(drill oval 0.7 2.5)");
  });
});

describe("Board inline block", () => {
  const out = footprintInline(fp, {
    xNm: 25_000_000,
    yNm: 20_000_000,
    reference: "U1",
    value: "SOT-23-5",
  });

  test("position, library prefix, reference, and value all make it in", () => {
    expect(out).toContain('(footprint "project:demo-part"');
    expect(out).toContain("(at 25 20)");
    expect(out).toContain('(property "Reference" "U1"');
    expect(out).toContain('(property "Value" "SOT-23-5"');
  });

  test("uuid is derived from content: same input, same output", () => {
    const again = footprintInline(fp, {
      xNm: 25_000_000,
      yNm: 20_000_000,
      reference: "U1",
      value: "SOT-23-5",
    });
    expect(again).toBe(out);
    expect(deriveUuid("x")).toBe(deriveUuid("x"));
    expect(deriveUuid("x")).not.toBe(deriveUuid("y"));
    expect(deriveUuid("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
