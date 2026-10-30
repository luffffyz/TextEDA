// Board ↔ print page cross checks (spec/schematic-view.md §9).
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import { checkViews } from "../src/index.ts";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";

const board = {
  ir_version: irVersion,
  format: "0.8",
  board: "b",
  instances: [
    { id: "R1", component: "res-0402" },
    { id: "R2", component: "res-0402" },
  ],
  nets: [
    { id: "A", members: ["R1.1", "R2.1"] },
    { id: "GND", members: ["R1.2", "R2.2"] },
  ],
  ports: [{ id: "OUT", net: "A" }],
} as unknown as Schematic;

/** A page with the given sections; everything not given is empty. */
function page(
  pageId: string,
  sections: Partial<Pick<SchematicView, "place" | "wire" | "label" | "port">> = {},
): { file: string; view: SchematicView } {
  return {
    file: `views/b/${pageId}.view.teda`,
    view: {
      ir_version: irVersion,
      format: "0.7",
      board: "b",
      page: pageId,
      sheet: { width_nm: 297_000_000, height_nm: 210_000_000 },
      place: [],
      ...sections,
    } as SchematicView,
  };
}

const PLACE_R1 = { instance_id: "R1", x_nm: 0, y_nm: 0 };
const PLACE_R2 = { instance_id: "R2", x_nm: 0, y_nm: 20_000_000 };
const WIRE = (net: string, from: string, to: string) => ({
  net,
  from_pin: from,
  to_pin: to,
});

describe("board ↔ print page", () => {
  test("the board's ids are the only ids a page may name", () => {
    const diagnostics = checkViews({
      file: "design/sch/b.teda",
      schematic: board,
      pages: [
        page("main", {
          place: [PLACE_R1, { instance_id: "R9", x_nm: 0, y_nm: 0 }],
          wire: [WIRE("NOPE", "R1.1", "R2.1")],
          label: [{ net: "ALSO_NOPE", x_nm: 0, y_nm: 0 }],
          port: [{ id: "NOT_A_PORT", x_nm: 0, y_nm: 0 }],
        }),
      ],
    });
    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain("ref.unknown-instance");
    expect(codes).toContain("ref.unknown-net");
    expect(codes).toContain("ref.unknown-port");
    // the id errors block; the coverage warning for the undrawn nets is a separate finding
    expect(diagnostics.filter((d) => d.code !== "view.nets-not-drawn").every((d) => d.severity === "error")).toBe(true);
    // both the wire and the label name a net the board does not have
    expect(diagnostics.filter((d) => d.code === "ref.unknown-net")).toHaveLength(2);
  });

  test("a wire endpoint must be a member of the net it draws", () => {
    const diagnostics = checkViews({
      file: "design/sch/b.teda",
      schematic: board,
      pages: [
        page("main", {
          place: [PLACE_R1, PLACE_R2],
          // R2.2 is on GND, not on A
          wire: [WIRE("A", "R1.1", "R2.2")],
        }),
      ],
    });
    const mismatch = diagnostics.filter((d) => d.code === "view.pin-net-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.message).toContain("R2.2");
    expect(mismatch[0]!.data).toMatchObject({ net: "A", pin: "R2.2" });
  });

  test("a wire that contradicts a net names the board's net row (ADR-0004 D5)", () => {
    const netRows = new Map([
      ["A", { file: "design/sch/b.teda", line: 9, col: 3 }],
    ]);
    const diagnostics = checkViews({
      file: "design/sch/b.teda",
      schematic: board,
      pages: [
        page("main", {
          place: [PLACE_R1, PLACE_R2],
          wire: [WIRE("A", "R1.1", "R2.2")],
        }),
      ],
      locateNet: (netId) => netRows.get(netId),
    });
    const mismatch = diagnostics.find((d) => d.code === "view.pin-net-mismatch")!;
    // The page is where the wrong endpoint is; the nets section is what says it is wrong.
    expect(mismatch.location).toMatchObject({ file: "views/b/main.view.teda" });
    expect(mismatch.related).toEqual([{ file: "design/sch/b.teda", line: 9, col: 3 }]);
  });

  test("a net drawn on no page is one warning per board, with the names", () => {
    const diagnostics = checkViews({
      file: "design/sch/b.teda",
      schematic: board,
      pages: [page("main", { place: [PLACE_R1, PLACE_R2], wire: [WIRE("A", "R1.1", "R2.1")] })],
    });
    const undrawn = diagnostics.filter((d) => d.code === "view.nets-not-drawn");
    // GND is drawn nowhere; A is drawn, and a single-member net would not count
    expect(undrawn).toHaveLength(1);
    expect(undrawn[0]!.severity).toBe("warning");
    expect(undrawn[0]!.data).toMatchObject({ count: 1, nets: "GND" });
  });

  test("a board with logic and no page is legal: nothing is reported", () => {
    expect(checkViews({ file: "design/sch/b.teda", schematic: board, pages: [] })).toEqual([]);
  });

  test("coverage spans all pages of the board, not one page at a time", () => {
    const diagnostics = checkViews({
      file: "design/sch/b.teda",
      schematic: board,
      pages: [
        page("one", { place: [PLACE_R1], wire: [WIRE("A", "R1.1", "R2.1")] }),
        page("two", { place: [PLACE_R2], label: [{ net: "GND", x_nm: 0, y_nm: 0 }] }),
      ],
    });
    expect(diagnostics).toEqual([]);
  });
});
