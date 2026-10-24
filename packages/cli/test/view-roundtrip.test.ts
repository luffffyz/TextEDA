// Round-trip of the reference project's print pages: what the drawing shows must equal what the
// view IR says (AGENTS.md §2 invariant 4, ADR-0014 decision 5). The synthetic cases live in
// `packages/renderer/test/schematic-roundtrip.test.ts`; this one runs every page that exists.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchematic, parseView } from "@texteda/parser";
import type { Schematic } from "@texteda/ir/schematic";
import { extractSchematic, renderSchematic, schematicProjection } from "@texteda/renderer";
import { loadBoard, loadComponents, loadModules } from "../src/project.ts";
import { loadSymbolLibrary, schematicInstances } from "../src/symbols.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples", "reference-project");

const boards = ["charger-buck", "mcu-board"];
const { resolver, shards } = loadComponents(projectRoot);
const symbols = loadSymbolLibrary(projectRoot);

function pagesOf(board: string) {
  const loaded = loadBoard(projectRoot, board);
  if (!loaded) throw new Error(`reference project has no board ${board}`);
  const schematic = parseSchematic(loaded.text, {
    file: loaded.file,
    board,
    components: resolver,
    modules: loadModules(projectRoot),
  });
  if (!schematic.ir) throw new Error(`reference project board ${board} does not compile`);
  const instances = schematicInstances(
    schematic.ir as Schematic,
    (componentId) => resolver.resolve(componentId)?.pins ?? [],
    (componentId) => shards.find((shard) => shard.id === componentId)?.ir.component.symbol,
    symbols,
    // The same device facts the CLI hands the renderer: the page prints values, and both ends of the
    // round-trip must compute that substitution (a placeholder on one side would show as a difference).
    (componentId) => {
      const component = shards.find((shard) => shard.id === componentId)?.ir.component;
      if (component === undefined) return undefined;
      return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
    },
  );
  return { views: loaded.views, instances };
}

describe("print page round-trip", () => {
  const covered: string[] = [];

  for (const board of boards) {
    const { views, instances } = pagesOf(board);
    for (const source of views) {
      const view = parseView(source.text, { file: source.file, board });
      if (!view.ir) throw new Error(`reference project view ${source.file} does not parse`);
      const page = `${board}/${view.ir.page}`;
      covered.push(page);

      test(`${page}: the drawing reverse-extracts into the view's projection`, () => {
        const doc = renderSchematic(view.ir!, instances);
        const projection = schematicProjection(view.ir!, instances);
        // A page that placed nothing would pass vacuously.
        expect(projection.pins.length).toBeGreaterThan(0);
        expect(extractSchematic(doc)).toEqual(projection);
      });

      test(`${page}: every placed instance names itself in the drawing`, () => {
        const projection = extractSchematic(renderSchematic(view.ir!, instances));
        const references = new Set(
          projection.texts.filter((text) => text.role === "field" && text.name === "Reference").map((text) => text.text),
        );
        for (const place of view.ir!.place) expect(references.has(place.instance_id)).toBe(true);
      });
    }
  }

  test("the reference project actually has pages to check", () => {
    expect(covered).toContain("charger-buck/buck-5v");
    expect(covered).toContain("charger-buck/charger-power");
  });
});
