// Unit tests for `view` parsing and canonical formatting.
//
// The positive case is a real view file; the negative cases break exactly one thing each and the
// diagnostic code must line up. The formatting test checks the canonical form is idempotent.
import { describe, expect, test } from "bun:test";
import { validate } from "@texteda/ir";
import { formatView } from "../src/fmt-view.ts";
import { parseView } from "../src/view.ts";

const file = "sch/charger-buck/buck-5v.view.teda";

const SOURCE = `version 0.7
view buck-5v

sheet 297 210

# the buck input stage
place
  U1    40.0  30.0
  C1    20.0  30.0  90
  U2    80.0  30.0  0   unit=2

wire
  VDD   U1.5  C1.1  35.0 25.0
  GND   C1.2  U2.4  15.0 25.0  15.0 12.0

label
  VDD   35.0  25.0

port
  SYS_OUT  280.0  105.0  180

text
  12.0  8.0  Rev A — power section
`;

describe("view parsing", () => {
  test("parses a full view file into the IR shard", () => {
    const result = parseView(SOURCE, { file, board: "charger-buck" });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const ir = result.ir!;
    expect(ir.ir_version).toBe("0.2");
    expect(ir.format).toBe("0.7");
    expect(ir.board).toBe("charger-buck");
    expect(ir.page).toBe("buck-5v");
    expect(ir.sheet).toEqual({ width_nm: 297_000_000, height_nm: 210_000_000 });
    expect(ir.place.map((p) => p.instance_id)).toEqual(["U1", "C1", "U2"]);
    expect(ir.place[0]!.x_nm).toBe(40_000_000);
    // A zero rotation and unit 1 are the defaults: the IR omits them.
    expect(ir.place[0]!.rot_mdeg).toBeUndefined();
    expect(ir.place[1]!.rot_mdeg).toBe(90_000);
    expect(ir.place[2]!.unit).toBe(2);
    expect(ir.wire).toHaveLength(2);
    expect(ir.wire![0]!.points).toEqual([{ x_nm: 35_000_000, y_nm: 25_000_000 }]);
    expect(ir.wire![1]!.points).toEqual([
      { x_nm: 15_000_000, y_nm: 25_000_000 },
      { x_nm: 15_000_000, y_nm: 12_000_000 },
    ]);
    expect(ir.label![0]).toMatchObject({ net: "VDD", x_nm: 35_000_000, y_nm: 25_000_000 });
    expect(ir.port![0]).toMatchObject({ id: "SYS_OUT", rot_mdeg: 180_000 });
    expect(ir.text![0]!.text).toBe("Rev A — power section");
  });

  test("the IR satisfies the schematic-view contract", () => {
    const ir = parseView(SOURCE, { file, board: "charger-buck" }).ir!;
    const result = validate("schematic-view", ir);
    expect({ ...result, errors: result.errors }).toEqual({ ok: true, errors: [] });
  });

  test("the sheet defaults to A4 landscape", () => {
    const source = "version 0.7\nview main\n\nplace\n  U1  10.0  10.0\n";
    const ir = parseView(source, { file, board: "b" }).ir!;
    expect(ir.sheet).toEqual({ width_nm: 297_000_000, height_nm: 210_000_000 });
  });
});

describe("view diagnostics", () => {
  const cases: { name: string; source: string; code: string }[] = [
    {
      name: "a wire endpoint whose instance is not placed",
      source: "version 0.7\nview main\n\nplace\n  U1  10.0  10.0\n\nwire\n  VDD  U1.5  C1.1\n",
      code: "view.pin-not-placed",
    },
    {
      name: "a coordinate outside the sheet",
      source: "version 0.7\nview main\n\nplace\n  U1  400.0  10.0\n",
      code: "view.out-of-sheet",
    },
    {
      name: "a rotation that is not a right angle",
      source: "version 0.7\nview main\n\nplace\n  U1  10.0  10.0  45\n",
      code: "value.angle-invalid",
    },
    {
      name: "a pin reference that is not a board-level instance",
      source: "version 0.7\nview main\n\nplace\n  U1  10.0  10.0\n\nwire\n  VDD  M2.U1.5  U1.6\n",
      code: "syntax.invalid-ref",
    },
    {
      name: "an odd number of bend coordinates",
      source: "version 0.7\nview main\n\nplace\n  U1  10.0  10.0\n\nwire\n  VDD  U1.5  U1.6  10.0\n",
      code: "syntax.row-too-short",
    },
    {
      name: "a coordinate finer than the 0.1 mm grid",
      source: "version 0.7\nview main\n\nplace\n  U1  10.05  10.0\n",
      code: "value.length-invalid",
    },
    {
      name: "an unknown key in the place tail",
      source: "version 0.7\nview main\n\nplace\n  U1  10.0  10.0  colour=red\n",
      code: "syntax.unknown-field",
    },
    {
      name: "an unknown section",
      source: "version 0.7\nview main\n\nnotes\n  hello\n",
      code: "syntax.unknown-field",
    },
    {
      name: "a version that predates the current view form",
      source: "version 0.6\nview main\n\nplace\n  U1  10.0  10.0\n",
      code: "format.unsupported-version",
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      const result = parseView(c.source, { file, board: "b" });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((d) => d.code)).toContain(c.code as never);
    });
  }
});

describe("view canonical form", () => {
  test("sorts the rows, aligns the columns and is idempotent", () => {
    const messy = `version 0.7
view main

place
  C10  20.0  30.0
  U1   30.0  30.0
  C2   10.0  30.0

wire
  VDD  U1.5  C2.1  10.0 20.0

label
  VDD  10.0  20.0
`;
    const first = formatView(messy, { file });
    expect(first.ok).toBe(true);
    expect(first.text).toBe(
      `version 0.7
view main

place
  C2   10.0  30.0
  C10  20.0  30.0
  U1   30.0  30.0

wire
  VDD  U1.5  C2.1  10.0 20.0

label
  VDD  10.0  20.0
`,
    );
    const second = formatView(first.text!, { file });
    expect(second.text).toBe(first.text);
  });

  test("keeps the optional port rotation", () => {
    const source = `version 0.7
view main

place
  U1  10.0  10.0

port
  GND  10.0  10.0  180
  VDD  20.0  10.0
`;
    const first = formatView(source, { file });
    expect(first.ok).toBe(true);
    expect(first.text).toContain("GND  10.0  10.0  180");
    const reparsed = parseView(first.text!, { file, board: "b" });
    expect(reparsed.ok).toBe(true);
    expect(reparsed.ir!.port![0]).toMatchObject({ id: "GND", rot_mdeg: 180_000 });
    const second = formatView(first.text!, { file });
    expect(second.text).toBe(first.text);
  });

  test("keeps the comments attached to their row", () => {
    const source = `version 0.7
view main

place
  # the input cap
  C2   10.0  30.0
  C10  20.0  30.0
`;
    const result = formatView(source, { file });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("# the input cap");
    expect(result.text!.indexOf("# the input cap")).toBeLessThan(result.text!.indexOf("C2"));
  });

  test("produces no output when the file has errors", () => {
    const result = formatView("version 0.7\nview main\n\nplace\n  U1  400.0  10.0\n", { file });
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });
});
