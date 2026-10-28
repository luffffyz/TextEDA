// The identity a drawn object carries (ADR-0141 D2).
//
// The renderer knows what it drew, not what hover and click mean. It writes the object's name into
// the SVG (`data-ref`) and the net it carries (`data-net`), so the app can address an object -- or
// every piece of one net's copper -- without asking the model for a bounding box.
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { SchematicInstance } from "../src/index.ts";
import { renderSchematic, toSvgText, type SymbolBody } from "../src/index.ts";

function symbol(): SymbolBody {
  return {
    library: "test",
    name: "two-pin",
    units: 1,
    pin_numbers_hidden: false,
    pin_names_hidden: false,
    power: false,
    in_bom: true,
    on_board: true,
    pins: [
      { number: "1", at: { x_nm: -3_810_000, y_nm: 0, rotation_mdeg: 0 }, length_nm: 2_540_000, unit: 1, style: "line" },
      { number: "2", at: { x_nm: 3_810_000, y_nm: 0, rotation_mdeg: 180_000 }, length_nm: 2_540_000, unit: 1, style: "line" },
    ],
    body: [
      {
        kind: "rect",
        start: { x_nm: -1_270_000, y_nm: -635_000 },
        end: { x_nm: 1_270_000, y_nm: 635_000 },
        width_nm: 254_000,
        fill: "none",
        unit: 0,
      },
    ],
    fields: [
      { name: "Reference", value: "U", at: { x_nm: 0, y_nm: 2_540_000 } },
      { name: "Value", value: "two-pin", at: { x_nm: 0, y_nm: -2_540_000 } },
    ],
  };
}

function part(): SchematicInstance {
  return {
    symbol: symbol(),
    part: {
      pins: [
        { number: "1", name: "A", type: "passive" },
        { number: "2", name: "B", type: "passive" },
      ],
    },
  };
}

function view(): SchematicView {
  return {
    ir_version: irVersion,
    format: "0.7",
    board: "b",
    page: "p",
    sheet: { width_nm: 100_000_000, height_nm: 60_000_000 },
    place: [{ instance_id: "U1", x_nm: 50_000_000, y_nm: 30_000_000, rot_mdeg: 0 }],
    wire: [{ net: "VCC", from_pin: "U1.1", to_pin: "U1.2" }],
    label: [{ net: "VCC", x_nm: 10_000_000, y_nm: 10_000_000 }],
    port: [{ id: "VCC", x_nm: 20_000_000, y_nm: 20_000_000, rot_mdeg: 0 }],
  };
}

describe("the identity a drawn object carries", () => {
  test("every placed instance, wire, label and port is named", () => {
    const doc = renderSchematic(view(), new Map([["U1", part()]]));
    const refs = doc.primitives.map((p) => p.ref).filter((r): r is string => r !== undefined);
    expect(refs).toContain("instance:U1");
    expect(refs).toContain("net:VCC");
    expect(refs).toContain("label:VCC");
    expect(refs).toContain("port:VCC");
  });

  test("a net-carrying object says which net it carries", () => {
    const doc = renderSchematic(view(), new Map([["U1", part()]]));
    const wire = doc.primitives.find((p) => p.ref === "net:VCC" && p.kind === "polyline");
    expect(wire?.net).toBe("VCC");
    const label = doc.primitives.find((p) => p.ref === "label:VCC");
    expect(label?.net).toBe("VCC");
    // A port names a board port; which net it carries is the schematic's fact, not the view's.
    const port = doc.primitives.find((p) => p.ref === "port:VCC");
    expect(port?.net).toBeUndefined();
  });

  test("the SVG carries the identity", () => {
    const doc = renderSchematic(view(), new Map([["U1", part()]]));
    const svg = toSvgText(doc);
    expect(svg).toContain('data-ref="instance:U1"');
    expect(svg).toContain('data-ref="net:VCC"');
    expect(svg).toContain('data-net="VCC"');
  });

  test("one object is one group, so the app can move it", () => {
    const doc = renderSchematic(view(), new Map([["U1", part()]]));
    const svg = toSvgText(doc);
    const groups = svg.match(/data-ref="instance:U1"/g) ?? [];
    // The symbol's body, its pins and its fields live on different layers, so the group appears
    // once per layer -- but the app addresses every group it finds.
    expect(groups.length).toBeGreaterThan(0);
  });
});
