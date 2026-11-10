// Project ↔ print page cross checks (spec/schematic-view.md §9).
import { irVersion } from "@texteda/ir";
import { describe, expect, test } from "bun:test";
import { checkViews } from "../src/index.ts";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { ReadabilityGeometry } from "../src/view/facts.ts";

const projectSchematic = {
  ir_version: irVersion,
  format: "0.8",
  project: "main",
  modules: [],
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

/** The drawn box of one module instance (the page's `module` section, ADR-0067 D3). */
interface ModuleFrame {
  instance_id: string;
  module_id: string;
  x_nm: number;
  y_nm: number;
  width_nm: number;
  height_nm: number;
}

/** The drawn position of one module port (the page's `module_port` section, ADR-0067 D3). */
interface ModulePortRow {
  id: string;
  x_nm: number;
  y_nm: number;
}

/** A page with the given sections; everything not given is empty. */
function page(
  pageId: string,
  sections: Partial<Pick<SchematicView, "place" | "junction" | "wire" | "label" | "port">> & {
    module?: ModuleFrame[];
    module_port?: ModulePortRow[];
  } = {},
): { file: string; view: SchematicView } {
  return {
    file: `views/${pageId}.view.teda`,
    view: {
      ir_version: irVersion,
      format: "0.7",
      project: "main",
      page: pageId,
      sheet: { width_nm: 297_000_000, height_nm: 210_000_000 },
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

describe("project ↔ print page", () => {
  test("the project's ids are the only ids a page may name", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
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
    // both the wire and the label name a net the project does not have
    expect(diagnostics.filter((d) => d.code === "ref.unknown-net")).toHaveLength(2);
  });

  test("a wire endpoint must be a member of the net it draws", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
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

  test("a wire that contradicts a net names the project's root net row (ADR-0004 D5)", () => {
    const netRows = new Map([
      ["A", { file: "design/sch/main.teda", line: 9, col: 3 }],
    ]);
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
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
    expect(mismatch.location).toMatchObject({ file: "views/main.view.teda" });
    expect(mismatch.related).toEqual([{ file: "design/sch/main.teda", line: 9, col: 3 }]);
  });
  test("a named junction connects wire rows without changing the project net", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [page("main", {
        place: [PLACE_R1, PLACE_R2],
        junction: [{ id: "J1", x_nm: 10_000_000, y_nm: 10_000_000 }],
        wire: [WIRE("A", "R1.1", "J1"), WIRE("A", "J1", "R2.1")],
      })],
    });
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  test("renderer geometry requires wires to name a junction they pass through", () => {
    const geometry = {
      texts: [],
      fields: [],
      symbols: [
        { instance_id: "R1", box: { min_x_nm: -1, min_y_nm: -1, max_x_nm: 1, max_y_nm: 1 }, pins: new Map([["1", { x_nm: 0, y_nm: 0 }]]) },
        { instance_id: "R2", box: { min_x_nm: 9_999_999, min_y_nm: -1, max_x_nm: 10_000_001, max_y_nm: 1 }, pins: new Map([["1", { x_nm: 10_000_000, y_nm: 0 }]]) },
      ],
    } satisfies ReadabilityGeometry;
    const valid = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [{
        ...page("valid-tree", {
          place: [PLACE_R1, PLACE_R2],
          junction: [{ id: "J1", x_nm: 5_000_000, y_nm: 0 }],
          wire: [WIRE("A", "R1.1", "J1"), WIRE("A", "J1", "R2.1")],
        }),
        geometry,
      }],
    });
    expect(valid.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

    const gapped = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [{
        ...page("gap", {
          place: [PLACE_R1, PLACE_R2],
          junction: [{ id: "J1", x_nm: 5_000_000, y_nm: 0 }],
          wire: [WIRE("A", "R1.1", "R2.1"), WIRE("A", "R1.1", "J1"), WIRE("A", "J1", "R2.1")],
        }),
        geometry,
      }],
    });
    expect(gapped.find((diagnostic) => diagnostic.code === "view.wire-gap")?.data).toMatchObject({ page: "gap", net: "A", junction: "J1" });
  });

  test("an unresolved rendered pin endpoint is reported as dangling", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [{
        ...page("dangling", {
          place: [PLACE_R1, PLACE_R2],
          wire: [WIRE("A", "R1.99", "R2.1")],
        }),
        geometry: {
          texts: [],
          fields: [],
          symbols: [
            { instance_id: "R1", box: { min_x_nm: -1, min_y_nm: -1, max_x_nm: 1, max_y_nm: 1 }, pins: new Map([["1", { x_nm: 0, y_nm: 0 }]]) },
            { instance_id: "R2", box: { min_x_nm: 9_999_999, min_y_nm: -1, max_x_nm: 10_000_001, max_y_nm: 1 }, pins: new Map([["1", { x_nm: 10_000_000, y_nm: 0 }]]) },
          ],
        },
      }],
    });
    expect(diagnostics.find((diagnostic) => diagnostic.code === "view.wire-dangling-endpoint")?.data)
      .toMatchObject({ page: "dangling", net: "A", endpoint: "R1.99" });
  });

  test("an isolated junction and a junction shared by different nets are errors", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [page("main", {
        place: [PLACE_R1, PLACE_R2],
        junction: [
          { id: "J1", x_nm: 10_000_000, y_nm: 10_000_000 },
          { id: "J2", x_nm: 20_000_000, y_nm: 20_000_000 },
        ],
        wire: [WIRE("A", "R1.1", "J1"), WIRE("GND", "R1.2", "J1")],
      })],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("view.endpoint-wrong-net");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("view.junction-isolated");
  });
  test("a junction with more than four wire arms is invalid", () => {
    const overflowProject = {
      ...projectSchematic,
      instances: Array.from({ length: 5 }, (_, index) => ({ id: `R${index + 1}`, component: "res-0402" })),
      nets: [{ id: "A", members: Array.from({ length: 5 }, (_, index) => `R${index + 1}.1`) }],
      ports: [],
    } as unknown as Schematic;
    const junction = { id: "J1", x_nm: 10_000_000, y_nm: 10_000_000 };
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: overflowProject,
      pages: [page("main", {
        place: Array.from({ length: 5 }, (_, index) => ({ instance_id: `R${index + 1}`, x_nm: index * 1_000_000, y_nm: 0 })),
        junction: [junction],
        wire: Array.from({ length: 5 }, (_, index) => WIRE("A", `R${index + 1}.1`, "J1")),
      })],
    });
    const invalid = diagnostics.find((diagnostic) => diagnostic.code === "view.junction-invalid-degree");
    expect(invalid?.data).toMatchObject({ junction: "J1", degree: 5 });
  });
  test("wire rows on one net must belong to one endpoint-connected component", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [page("main", {
        place: [PLACE_R1, PLACE_R2],
        wire: [WIRE("A", "R1.1", "R2.1"), WIRE("A", "R1.2", "R2.2")],
      })],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("view.wire-disconnected");
  });
  test("a drawn net must include every member placed on the page", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [page("main", {
        place: [PLACE_R1, PLACE_R2],
        wire: [WIRE("A", "R1.1", "R1.1")],
      })],
    });
    const disconnected = diagnostics.find((diagnostic) => diagnostic.code === "view.wire-disconnected");
    expect(disconnected?.data).toMatchObject({ net: "A", missing_members: "R2.1" });
  });

  test("a net drawn on no page is one warning per project, with the names", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [page("main", { place: [PLACE_R1, PLACE_R2], wire: [WIRE("A", "R1.1", "R2.1")] })],
    });
    const undrawn = diagnostics.filter((d) => d.code === "view.nets-not-drawn");
    // GND is drawn nowhere; A is drawn, and a single-member net would not count
    expect(undrawn).toHaveLength(1);
    expect(undrawn[0]!.severity).toBe("warning");
    expect(undrawn[0]!.data).toMatchObject({ count: 1, nets: "GND" });
  });

  test("a project with logic and no page is legal: nothing is reported", () => {
    expect(checkViews({ file: "design/sch/main.teda", schematic: projectSchematic, pages: [] })).toEqual([]);
  });

  test("coverage spans all pages of the project, not one page at a time", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: projectSchematic,
      pages: [
        page("one", { place: [PLACE_R1], wire: [WIRE("A", "R1.1", "R2.1")] }),
        page("two", { place: [PLACE_R2], label: [{ net: "GND", x_nm: 0, y_nm: 0 }] }),
      ],
    });
    expect(diagnostics).toEqual([]);
  });
});

/** A project of two modules: the composition lives in the project root, the IR stays flat. */
const moduleProject = {
  ir_version: irVersion,
  format: "0.9",
  project: "main",
  modules: [
    {
      instance_id: "M1",
      module_id: "charger-power",
      ports: [
        { id: "GND", net: "GND", pins: ["M1.U1.1"] },
        { id: "SYS_OUT", net: "SYS", pins: ["M1.U1.3"] },
      ],
    },
    {
      instance_id: "M2",
      module_id: "buck-5v",
      ports: [
        { id: "GND", net: "GND", pins: ["M2.U1.1"] },
        { id: "SYS_IN", net: "SYS", pins: ["M2.U1.3"] },
      ],
    },
  ],
  instances: [
    { id: "M1.U1", component: "reg-3v3" },
    { id: "M2.U1", component: "reg-3v3" },
  ],
  nets: [
    { id: "SYS", members: ["M1.U1.3", "M2.U1.3"] },
    { id: "GND", members: ["M1.U1.1", "M2.U1.1"] },
  ],
} as unknown as Schematic;

/** The project's module instances and the ports their modules declare (spec/module.md §7.2). */
const moduleFacts = [
  {
    instance_id: "M1",
    module_id: "charger-power",
    ports: [
      { id: "GND", net: "GND" },
      { id: "SYS_OUT", net: "SYS" },
    ],
  },
  {
    instance_id: "M2",
    module_id: "buck-5v",
    ports: [
      { id: "GND", net: "GND" },
      { id: "SYS_IN", net: "SYS" },
    ],
  },
];

const FRAME_M1: ModuleFrame = {
  instance_id: "M1",
  module_id: "charger-power",
  x_nm: 20_000_000,
  y_nm: 20_000_000,
  width_nm: 90_000_000,
  height_nm: 60_000_000,
};
const FRAME_M2: ModuleFrame = {
  instance_id: "M2",
  module_id: "buck-5v",
  x_nm: 150_000_000,
  y_nm: 20_000_000,
  width_nm: 80_000_000,
  height_nm: 60_000_000,
};
const PORT_M1_GND: ModulePortRow = { id: "M1.GND", x_nm: 20_000_000, y_nm: 80_000_000 };
const PORT_M1_SYS: ModulePortRow = { id: "M1.SYS_OUT", x_nm: 110_000_000, y_nm: 50_000_000 };
const PORT_M2_GND: ModulePortRow = { id: "M2.GND", x_nm: 150_000_000, y_nm: 80_000_000 };
const PORT_M2_SYS: ModulePortRow = { id: "M2.SYS_IN", x_nm: 150_000_000, y_nm: 50_000_000 };

/** The overview: one frame per module instance, the module ports, and the project nets between them. */
const OVERVIEW = {
  module: [FRAME_M1, FRAME_M2],
  module_port: [PORT_M1_GND, PORT_M1_SYS, PORT_M2_GND, PORT_M2_SYS],
  wire: [WIRE("SYS", "M1.SYS_OUT", "M2.SYS_IN"), WIRE("GND", "M1.GND", "M2.GND")],
};

/** The overview: one frame per module instance, the module ports, and the project nets between them. */
describe("the module overview", () => {
  test("the overview draws the project's composition once, on the project's bindings", () => {
    const overview = page("main", OVERVIEW);
    expect(overview.view.place).toBeUndefined();
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [overview],
    });
    expect(diagnostics).toEqual([]);
  });
  test("reusable placements may repeat one module instance drawing and resolve wire endpoints", () => {
    const drawing = {
      module_id: "buck-5v",
      bounds: { width_nm: 20_000_000, height_nm: 10_000_000 },
      place: [{ instance_id: "U1" }],
      nets: [{ id: "SYS" }, { id: "GND" }],
      ports: [{ id: "SYS_IN" }, { id: "GND" }],
      port: [
        { id: "SYS_IN", x_nm: 20_000_000, y_nm: 5_000_000 },
        { id: "GND", x_nm: 0, y_nm: 5_000_000 },
      ],
    };
    const chargerDrawing = {
      module_id: "charger-power",
      bounds: { width_nm: 20_000_000, height_nm: 10_000_000 },
      place: [],
      nets: [{ id: "SYS" }, { id: "GND" }],
      ports: [{ id: "SYS_OUT" }, { id: "GND" }],
      port: [
        { id: "SYS_OUT", x_nm: 20_000_000, y_nm: 5_000_000 },
        { id: "GND", x_nm: 0, y_nm: 5_000_000 },
      ],
    };
    const composed = {
      ...page("detail"),
      view: {
        ...page("detail").view,
        template: "landscape",
        module_place: [
          { instance_id: "M1", module_id: "charger-power", x_nm: 0, y_nm: 10_000_000 },
          { instance_id: "M2", module_id: "buck-5v", x_nm: 30_000_000, y_nm: 10_000_000 },
          { instance_id: "M2", module_id: "buck-5v", x_nm: 60_000_000, y_nm: 10_000_000, rot_mdeg: 90000 },
        ],
        wire: [WIRE("SYS", "M1.SYS_OUT", "M2.SYS_IN"), WIRE("GND", "M1.GND", "M2.GND")],
      } as SchematicView,
      geometry: { texts: [], fields: [], symbols: [] } satisfies ReadabilityGeometry,
    };
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      moduleDrawings: [drawing, chargerDrawing],
      moduleDefinitions: [
        { module_id: "buck-5v", instance_ids: ["U1"], net_ids: ["SYS", "GND"], ports: [{ id: "SYS_IN", net: "SYS" }, { id: "GND", net: "GND" }] },
        { module_id: "charger-power", instance_ids: [], net_ids: ["SYS", "GND"], ports: [{ id: "SYS_OUT", net: "SYS" }, { id: "GND", net: "GND" }] },
      ],
      templates: [{ template_id: "landscape", size: { width_nm: 100_000_000, height_nm: 80_000_000 } }],
      pages: [composed],
    });
    expect(diagnostics).toEqual([]);
  });

  test("rotated local module bounds are checked against the template page extent", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      moduleDrawings: [{ module_id: "buck-5v", bounds: { width_nm: 20_000_000, height_nm: 10_000_000 }, place: [], nets: [], ports: [], port: [] }],
      templates: [{ template_id: "small", size: { width_nm: 30_000_000, height_nm: 30_000_000 } }],
      pages: [{
        ...page("main"),
        view: {
          ...page("main").view,
          template: "small",
          module_place: [{ instance_id: "M2", module_id: "buck-5v", x_nm: 25_000_000, y_nm: 0, rot_mdeg: 90000 }],
        } as SchematicView,
      }],
    });
    const outside = diagnostics.filter((diagnostic) => diagnostic.code === "view.out-of-sheet");
    expect(outside).toHaveLength(1);
    expect(outside[0]!.data).toMatchObject({ page: "main", instance: "M2", module_id: "buck-5v" });
  });

  test("reusable placement module ids and module port references use existing diagnostics", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      moduleDrawings: [{ module_id: "buck-5v", bounds: { width_nm: 20_000_000, height_nm: 10_000_000 }, place: [], nets: [], ports: [], port: [] }],
      pages: [{
        ...page("main"),
        view: {
          ...page("main").view,
          module_place: [
            { instance_id: "M2", module_id: "charger-power", x_nm: 0, y_nm: 0 },
            { instance_id: "M2", module_id: "buck-5v", x_nm: 30_000_000, y_nm: 0 },
          ],
          module_port: [{ id: "M2.NOT_A_PORT", x_nm: 30_000_000, y_nm: 5_000_000 }],
        } as SchematicView,
      }],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("view.module-id-mismatch");
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("ref.unknown-port");
  });

  test("a frame for a module instance the project does not have is unknown", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", {
        ...OVERVIEW,
        module: [...OVERVIEW.module, { instance_id: "M9", module_id: "charger-power", x_nm: 0, y_nm: 0, width_nm: 10_000_000, height_nm: 10_000_000 }],
      })],
    });
    const unknown = diagnostics.filter((diagnostic) => diagnostic.code === "view.module-unknown-instance");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.data).toMatchObject({ page: "main", instance: "M9" });
  });

  test("two frames for one module instance are a duplicate", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", { ...OVERVIEW, module: [FRAME_M1, FRAME_M2, FRAME_M1] })],
    });
    const duplicate = diagnostics.filter((diagnostic) => diagnostic.code === "view.module-duplicate");
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]!.data).toMatchObject({ page: "main", instance: "M1", frames: 2 });
  });

  test("a project module instance without a frame is covered by an advisory warning", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", { ...OVERVIEW, module: [FRAME_M1] })],
    });
    const notDrawn = diagnostics.filter((diagnostic) => diagnostic.code === "view.modules-not-drawn");
    expect(notDrawn).toHaveLength(1);
    expect(notDrawn[0]!.severity).toBe("warning");
    expect(notDrawn[0]!.data).toMatchObject({ count: 1, modules: "M2", pages: 1 });
  });

  test("a frame that names another module than the project binds is a mismatch", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", { ...OVERVIEW, module: [FRAME_M1, { ...FRAME_M2, module_id: "charger-power" }] })],
    });
    const mismatch = diagnostics.filter((diagnostic) => diagnostic.code === "view.module-id-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]!.data).toMatchObject({
      page: "main",
      instance: "M2",
      module_id: "charger-power",
      project_module_id: "buck-5v",
    });
  });

  test("a module port the module does not declare is unknown", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", {
        ...OVERVIEW,
        module_port: [...OVERVIEW.module_port, { id: "M2.NOT_A_PORT", x_nm: 0, y_nm: 0 }],
      })],
    });
    const unknown = diagnostics.filter((diagnostic) => diagnostic.code === "ref.unknown-port");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.data).toMatchObject({ page: "main", port: "M2.NOT_A_PORT" });
  });

  test("a wire may not end at a module port the module does not declare", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", {
        ...OVERVIEW,
        wire: [WIRE("SYS", "M1.SYS_OUT", "M2.NOT_A_PORT"), WIRE("GND", "M1.GND", "M2.GND")],
      })],
    });
    const unknown = diagnostics.filter((diagnostic) => diagnostic.code === "ref.unknown-port");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.data).toMatchObject({ page: "main", port: "M2.NOT_A_PORT" });
    // a module port is the module's interface, not a pin of an instance
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("view.pin-net-mismatch");
  });

  test("a module port the page does not draw is not drawn", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [page("main", {
        ...OVERVIEW,
        module_port: OVERVIEW.module_port.filter((port) => port.id !== "M2.SYS_IN"),
      })],
    });
    const notDrawn = diagnostics.filter((diagnostic) => diagnostic.code === "view.module-port-not-drawn");
    expect(notDrawn).toHaveLength(1);
    expect(notDrawn[0]!.data).toMatchObject({ page: "main", net: "SYS", port: "M2.SYS_IN" });
  });

  test("a module port bound to another project net than the wire is wrong", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: [
        { ...moduleFacts[0]!, ports: [{ id: "GND", net: "GND" }, { id: "SYS_OUT", net: "GND" }] },
        moduleFacts[1]!,
      ],
      pages: [page("main", OVERVIEW)],
    });
    const wrong = diagnostics.filter((diagnostic) => diagnostic.code === "view.module-port-wrong-net");
    expect(wrong).toHaveLength(1);
    expect(wrong[0]!.data).toMatchObject({ page: "main", net: "SYS", port: "M1.SYS_OUT", bound_net: "GND" });
  });

  test("a module port the page draws is a connection point, frame or no frame", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [{
        ...page("main", { ...OVERVIEW, module: [FRAME_M1] }),
        geometry: { texts: [], fields: [], symbols: [] } satisfies ReadabilityGeometry,
      }],
    });
    // M2 has no frame, so its ports are drawn without one: the endpoint is still where the page
    // draws it, and project-wide module coverage reports the missing frame as an advisory warning.
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["view.modules-not-drawn"]);
  });

  test("a detail page mixes and splits the components of several modules freely", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [
        page("buck-5v", { place: [{ instance_id: "M1.U1", x_nm: 0, y_nm: 0 }, { instance_id: "M2.U1", x_nm: 10_000_000, y_nm: 0 }] }),
        page("charger-power", { place: [{ instance_id: "M1.U1", x_nm: 0, y_nm: 0 }] }),
      ],
    });
    // Detail pages may place any project components freely; module-frame coverage is advisory.
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  test("the main page comes before other pages", () => {
    const diagnostics = checkViews({
      file: "design/sch/main.teda",
      schematic: moduleProject,
      modules: moduleFacts,
      pages: [
        page("z-detail", { place: [{ instance_id: "M9.U1", x_nm: 0, y_nm: 0 }] }),
        page("main", {
          ...OVERVIEW,
          module: [...OVERVIEW.module, { instance_id: "M9", module_id: "charger-power", x_nm: 0, y_nm: 0, width_nm: 10_000_000, height_nm: 10_000_000 }],
        }),
      ],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.data?.page)).toEqual(["main", "z-detail"]);
  });
});
