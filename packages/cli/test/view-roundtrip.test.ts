// Round-trip of the reference project's print pages: what the drawing shows must equal what the
// view IR says (AGENTS.md §2 invariant 4, ADR-0036 decision 5). The synthetic cases live in
// `packages/renderer/test/schematic-roundtrip.test.ts`; this one runs every page that exists.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchematic, parseView } from "@texteda/parser";
import type { Schematic } from "@texteda/ir/schematic";
import { composedGeometry, extractSchematic, renderComposedPage, renderSchematic, schematicProjection, toSvgText } from "@texteda/renderer";
import { loadComponents, loadModules, loadSchematic, loadViews } from "../src/project.ts";
import { loadPageComposition } from "../src/page-composition.ts";
import { loadSymbolLibrary, schematicInstances } from "../src/symbols.ts";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples", "reference-project");

const { resolver, shards } = loadComponents(projectRoot);
const symbols = loadSymbolLibrary(projectRoot);
const loaded = loadSchematic(projectRoot);
if (!loaded) throw new Error("reference project has no logical root schematic");
const schematic = parseSchematic(loaded.text, {
  file: loaded.file,
  components: resolver,
  modules: loadModules(projectRoot),
});
if (!schematic.ir) throw new Error("reference project logical root does not compile");
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
const views = loadViews(projectRoot);

describe("print page round-trip", () => {
  const covered: string[] = [];

  for (const source of views) {
    const view = parseView(source.text, { file: source.file });
    if (!view.ir) throw new Error(`reference project view ${source.file} does not parse`);
    const page = view.ir.page;
    covered.push(page);

    if (view.ir.template !== undefined || (view.ir.module_place?.length ?? 0) > 0) {
      test(`${page}: composes an optional template and repeated module drawing`, () => {
        const composition = loadPageComposition(projectRoot, view.ir!, symbols, { resolver, shards });
        expect(composition.errors).toEqual([]);
        expect(composition.view.sheet).toEqual({ width_nm: 594_000_000, height_nm: 420_000_000 });
        expect(composition.composition.drawings.get("buck-5v")?.bounds).toEqual({ width_nm: 145_000_000, height_nm: 40_000_000 });
        expect(composition.composition.drawings.get("charger-power")?.bounds).toEqual({ width_nm: 300_000_000, height_nm: 210_000_000 });
        expect(composition.composition.drawings.get("mcu-board")?.bounds).toEqual({ width_nm: 270_000_000, height_nm: 190_000_000 });
        const doc = renderComposedPage(composition.view, instances, composition.composition);
        const templatePrimitives = doc.primitives.filter(
          (primitive) => "layer" in primitive && primitive.layer === "template",
        );
        if (view.ir!.template === undefined) {
          expect(templatePrimitives).toHaveLength(0);
        } else {
          expect(templatePrimitives.length).toBeGreaterThan(0);
        }
        expect(doc.primitives.filter((primitive) => "layer" in primitive && primitive.layer === "module" && primitive.kind === "rect")).toHaveLength(3);
        const geometry = composedGeometry(composition.view, instances, composition.composition);
        expect(geometry.symbols.filter((symbol) => symbol.occurrence_id !== undefined).length).toBeGreaterThan(0);
        expect(geometry.modulePortPoints.get("M2.VOUT")).toEqual({ x_nm: 483_000_000, y_nm: 36_500_000 });
        expect(toSvgText(doc)).toContain("<svg");
      });
      continue;
    }

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
        projection.fields.filter((field) => field.name === "Reference").map((field) => field.text),
      );
      for (const place of view.ir!.place ?? []) expect(references.has(place.instance_id)).toBe(true);
    });
  }

  test("the reference project actually has pages to check", () => {
    expect(covered).toEqual(["main"]);
  });
});
