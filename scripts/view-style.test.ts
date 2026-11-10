// Tests for the print-page house style in scripts/lib/view-style.ts, which `bun run view:verify`
// applies (ADR-0059 D1).
// The verifier itself is an end-to-end script; these pin the rule it must keep saying: every
// coordinate a page stores is anchored on the 0.5 mm lattice, in both axes.
import { describe, expect, test } from "bun:test";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { viewHouseStyleProblems } from "./lib/view-style.ts";

const nm = (mm: number): number => Math.round(mm * 1e6);

const page = (over: Partial<SchematicView> = {}): SchematicView => ({
  ir_version: "0.15",
  format: "view",
  board: "b",
  page: "p",
  sheet: { width_nm: nm(297), height_nm: nm(210) },
  place: [],
  ...over,
});

describe("print-page house style", () => {
  test("a page whose coordinates are all on the lattice passes", () => {
    const view = page({
      place: [{ instance_id: "U1", x_nm: nm(40), y_nm: nm(30), rot_mdeg: 0 }],
      field: [{ instance_id: "U1", name: "Value", x_nm: nm(-0.5), y_nm: nm(-2) }],
      module: [{ instance_id: "M1", module_id: "power", x_nm: nm(80), y_nm: nm(40), width_nm: nm(40), height_nm: nm(30) }],
      module_port: [{ id: "M1.VIN", x_nm: nm(80), y_nm: nm(55) }],
      wire: [{ net: "V", from_pin: "M1.VIN", to_pin: "C1.1", points: [{ x_nm: nm(35), y_nm: nm(25) }] }],
      label: [{ net: "V", x_nm: nm(35), y_nm: nm(25) }],
      port: [{ id: "P1", x_nm: nm(280), y_nm: nm(105) }],
      text: [{ x_nm: nm(20), y_nm: nm(15), text: "note" }],
    });
    expect(viewHouseStyleProblems("t", view)).toEqual([]);
  });

  test("a module corner, size, and port off the lattice are reported", () => {
    const view = page({
      module: [{ instance_id: "M1", module_id: "power", x_nm: nm(80.25), y_nm: nm(40), width_nm: nm(40.25), height_nm: nm(30) }],
      module_port: [{ id: "M1.VIN", x_nm: nm(80.5), y_nm: nm(55.25) }],
    });
    const problems = viewHouseStyleProblems("t", view);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("module M1 corner");
    expect(problems[1]).toContain("module M1 size");
    expect(problems[2]).toContain("module port M1.VIN");
  });


  test("a placement off the lattice is reported", () => {
    const view = page({ place: [{ instance_id: "U1", x_nm: nm(40.25), y_nm: nm(30) }] });
    const [problem] = viewHouseStyleProblems("t", view);
    expect(problem).toContain("placement of U1");
    expect(problem).toContain("0.5 mm lattice");
  });

  test("a field anchor off the lattice is reported in symbol-local coordinates", () => {
    const view = page({
      field: [{ instance_id: "U1", name: "Value", x_nm: nm(-5.25), y_nm: nm(-15) }],
    });
    expect(viewHouseStyleProblems("t", view)[0]).toContain("field U1.Value");
  });

  test("a wire bend off the lattice is reported", () => {
    const view = page({
      wire: [
        {
          net: "V",
          from_pin: "U1.5",
          to_pin: "C1.1",
          points: [{ x_nm: nm(35), y_nm: nm(25.25) }],
        },
      ],
    });
    expect(viewHouseStyleProblems("t", view)[0]).toContain("bend of wire V");
  });

  test("a label, a port, and a note off the lattice are each reported", () => {
    const view = page({
      label: [{ net: "V", x_nm: nm(35.25), y_nm: nm(25) }],
      port: [{ id: "P1", x_nm: nm(280), y_nm: nm(105) }],
      text: [{ x_nm: nm(20), y_nm: nm(15), text: "note" }],
    });
    expect(viewHouseStyleProblems("t", view)[0]).toContain("label of net V");

    const withPort = page({ port: [{ id: "P1", x_nm: nm(280.25), y_nm: nm(105) }] });
    expect(viewHouseStyleProblems("t", withPort)[0]).toContain("port P1");

    const withNote = page({ text: [{ x_nm: nm(20.25), y_nm: nm(15), text: "note" }] });
    expect(viewHouseStyleProblems("t", withNote)[0]).toContain("note");
  });

  test("a negative multiple is still on the lattice", () => {
    // -0.5 mm is a lattice point; rounding it toward zero would make the rule reject a valid page.
    const view = page({ place: [{ instance_id: "U1", x_nm: nm(-40.5), y_nm: nm(-30.5) }] });
    expect(viewHouseStyleProblems("t", view)).toEqual([]);
  });

  test("a wire endpoint is not checked: it is a pin reference, not a free coordinate", () => {
    // The endpoints are pin references; the pin's own lattice is ADR-0057's business, and the pin's
    // position depends on the symbol the page places.
    const view = page({
      wire: [{ net: "V", from_pin: "U1.5", to_pin: "C1.1", points: [] }],
    });
    expect(viewHouseStyleProblems("t", view)).toEqual([]);
  });
});
