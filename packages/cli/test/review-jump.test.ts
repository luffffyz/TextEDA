// The review app's definition menu is mostly data selection, not DOM: these tests keep the
// F34 jump honest without a browser (ADR-0134 D6).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { definitionLocations, editorUri } from "../../viewer/src/definitions.ts";
import { buildReviewModel } from "../src/review.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

describe("review definition menu", () => {
  const model = buildReviewModel(referenceProject);
  const instance = model.boards
    .find((board) => board.id === "charger-buck")
    ?.instances.find((candidate) => candidate.id === "M2.C1")!;

  test("an instance lists the board/module row, placements and its device files", () => {
    const locations = definitionLocations({
      sources: model.sources,
      board: "charger-buck",
      selected: { kind: "symbol", id: "M2.C1" },
      instance,
      pins: ["1", "2"],
    });
    expect(locations.map((location) => location.kind)).toEqual([
      "instance",
      "pcb-place",
      "view-place",
      "component",
      "symbol",
      "footprint",
      "component-pin",
      "component-pin",
    ]);
    expect(locations.some((location) => location.file === "design/modules/buck-5v.teda")).toBe(true);
    expect(locations.some((location) => location.file === "views/charger-buck/buck-5v.view.teda")).toBe(true);
  });

  test("a net lists every wire and label that names it", () => {
    const locations = definitionLocations({
      sources: model.sources,
      board: "charger-buck",
      selected: { kind: "text", id: "SYS" },
    });
    expect(locations.map((location) => location.kind)).toContain("net");
    expect(locations.map((location) => location.kind)).toContain("view-wire");
    expect(locations.map((location) => location.kind)).toContain("view-label");
  });
});

describe("editor URI", () => {
  test("is vscode://file with an absolute path, line and column", () => {
    expect(
      editorUri("/srv/TextEDA", {
        kind: "instance",
        label: "sch instance row",
        file: "design/sch/a b#1.teda",
        line: 12,
        col: 3,
      }),
    ).toBe("vscode://file/srv/TextEDA/design/sch/a%20b%231.teda:12:3");
  });

  test("does not double the root slash or re-encode an already absolute file", () => {
    expect(
      editorUri("/srv/TextEDA/", {
        kind: "component",
        label: "component file",
        file: "/tmp/x.teda",
        line: 1,
        col: 1,
      }),
    ).toBe("vscode://file/tmp/x.teda:1:1");
  });
});
