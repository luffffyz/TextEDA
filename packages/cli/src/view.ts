// The `texteda view` verbs: what a print page measures, how it is drawn, and how its wiring is
// brought back onto its pins.
//
// The print page is the view layer's own description (S1), so its commands live under one noun
// (ADR-0044 D6). `view metrics` gives the numbers an agent iterates on, `view render` writes the
// drawing so a person can look at it, and `view rewire` puts the wiring back on the pins.
//
// An agent drawing a page iterates against numbers, not against pixels: the warnings say whether a
// label sits on its net, these numbers say how far off it is, how crowded the page is and where the
// wires pile up. Same geometry as the checks (`packages/renderer`'s `schematicGeometry`), so the
// metric and the warning can never disagree about where something is.
//
// Integer nanometres and ppm ratios only (ADR-0005): two runs, two machines, one table.
import { isAbsolute } from "node:path";
import { parseSchematic, parseView } from "@texteda/parser";
import type { Schematic } from "@texteda/ir/schematic";
import { composedGeometry, renderComposedPage, toSvgText } from "@texteda/renderer";
import { rerouteWire, viewMetrics, type ViewMetrics } from "@texteda/core";
import { loadSchematic, loadViews, loadComponents, loadModules } from "./project.ts";
import { loadPageComposition, pageCompositionError } from "./page-composition.ts";
import { loadSymbolLibrary, schematicInstances, type DeviceFacts } from "./symbols.ts";
import { pinPoint, renderInterconnects, renderPageSource, rewritePage } from "./layout.ts";
import { writeOut } from "./output.ts";
import type { VerbResult } from "./result.ts";

export interface ViewMetricsOptions {
  readonly root: string;
  /** Print page id. */
  readonly page: string;
  readonly json: boolean;
}

/** Millimetres with one decimal, from nanometres: readable without losing the order of magnitude. */
function mm(nm: number): string {
  return (nm / 1_000_000).toFixed(1);
}

function format(metrics: ViewMetrics): string {
  const lines: string[] = [];
  lines.push(`${metrics.project}/${metrics.page} — ${mm(metrics.sheet.width_nm)} × ${mm(metrics.sheet.height_nm)} mm sheet`);
  if (metrics.content) {
    const { content } = metrics;
    lines.push(
      `content   x ${mm(content.min_x_nm)}..${mm(content.max_x_nm)}  y ${mm(content.min_y_nm)}..${mm(content.max_y_nm)} mm  (${(metrics.content_fill_ppm / 10_000).toFixed(1)}% of the sheet)`,
    );
  } else {
    lines.push("content   nothing drawn");
  }
  const { counts } = metrics;
  lines.push(
    `counts    ${counts.instances} instances, ${counts.labels} labels, ${counts.ports} ports, ${counts.notes} notes, ${counts.wires} wires, ${counts.nets_undrawn} nets undrawn`,
  );
  const gap = (value: number | null): string => (value === null ? "—" : `${mm(value)} mm`);
  lines.push(
    `spacing   label min gap ${gap(metrics.label_min_gap_nm)}, text min gap ${gap(metrics.text_min_gap_nm)}`,
  );
  lines.push(
    `wires     ${mm(metrics.wire_total_nm)} mm total, ${metrics.wire_crossings} crossings of other nets, ${metrics.wires_through_bodies} through a body`,
  );
  const off = metrics.net_texts.filter((text) => text.distance_nm > 0);
  if (off.length === 0) {
    lines.push("net texts all sit on their nets");
  } else {
    lines.push("off their net:");
    for (const text of off) {
      lines.push(`  ${text.kind === "label" ? "label" : "port "} ${text.text} on ${text.net}: ${mm(text.distance_nm)} mm`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The page's measurements, or why they could not be measured. */
export function buildViewMetrics(options: ViewMetricsOptions): VerbResult<ViewMetrics> {
  const { root, page } = options;
  const loaded = loadSchematic(root);
  if (!loaded) {
    return { ok: false, code: "cli.bad-usage", error: "Project root file not found: design/sch/main.teda" };
  }
  const source = loadViews(root).find((view) => view.pageId === page);
  if (!source) {
    const available = loadViews(root).map((view) => view.pageId).join(", ") || "none";
    return {
      ok: false,
      code: "cli.bad-usage",
      error: `Print page ${page} not found (available: ${available})`,
    };
  }

  const { resolver, shards } = loadComponents(root);
  const schematic = parseSchematic(loaded.text, {
    file: loaded.file,
    components: resolver,
    modules: loadModules(root),
  });
  if (!schematic.ir) {
    return { ok: false, error: schematic.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  }
  const view = parseView(source.text, { file: source.file });
  if (!view.ir) {
    return { ok: false, error: view.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  }

  const symbols = loadSymbolLibrary(root);
  const instances = schematicInstances(
    schematic.ir as Schematic,
    (componentId) => resolver.resolve(componentId)?.pins ?? [],
    (componentId) => shards.find((shard) => shard.id === componentId)?.ir.component.symbol,
    symbols,
    (componentId): DeviceFacts | undefined => {
      const component = shards.find((shard) => shard.id === componentId)?.ir.component;
      if (component === undefined) return undefined;
      return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
    },
  );
  const composition = loadPageComposition(root, view.ir, symbols, { resolver, shards });
  if (composition.errors.length > 0) return { ok: false, error: pageCompositionError(composition.errors) };
  let geometry;
  try {
    geometry = composedGeometry(composition.view, instances, composition.composition);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return {
    ok: true,
    value: viewMetrics({
      view: composition.view,
      schematic: schematic.ir,
      geometry,
    }),
  };
}

/** Print the page's metrics. Returns the process exit code. */
export function runViewMetrics(options: ViewMetricsOptions): number {
  const result = buildViewMetrics(options);
  if (!result.ok) {
    console.error(result.error ?? "The page could not be measured");
    return 2;
  }
  process.stdout.write(options.json ? `${JSON.stringify(result.value, null, 2)}\n` : format(result.value!));
  return 0;
}

export interface ViewRewireOptions {
  readonly root: string;
  readonly page: string;
  /** Report what would change without writing the page. */
  readonly dryRun: boolean;
  readonly json: boolean;
}

export interface ViewRewireResult {
  /** The page's source file, relative to the project root. */
  readonly file: string;
  /** Whether the page was written. */
  readonly written: boolean;
  /** The wires that were brought back onto their pins, as `net from → to`. */
  readonly rewired: string[];
  /** The wires that could not be brought back, and why. */
  readonly conflicts: string[];
}

/**
 * Bring the page's wiring back onto its pins.
 *
 * The page's wires name their ends by pin, so the ends follow the symbols; the corners do not.
 * When a symbol moves, the run that leaves it can stop being orthogonal — that is what
 * `view.wire-diagonal` reports. This rewrites those corners: the interior keeps its coordinates,
 * the ends are put back where the pins are, and a wire whose interior is broken is reported instead
 * of redrawn (ADR-0042 D6).
 */
export function buildViewRewire(options: ViewRewireOptions): VerbResult<ViewRewireResult> {
  const { root, page } = options;
  const loaded = loadSchematic(root);
  if (!loaded) {
    return { ok: false, code: "cli.bad-usage", error: "Project root file not found: design/sch/main.teda" };
  }
  const source = loadViews(root).find((view) => view.pageId === page);
  if (!source) {
    const available = loadViews(root).map((view) => view.pageId).join(", ") || "none";
    return {
      ok: false,
      code: "cli.bad-usage",
      error: `Print page ${page} not found (available: ${available})`,
    };
  }

  const { resolver, shards } = loadComponents(root);
  const schematic = parseSchematic(loaded.text, {
    file: loaded.file,
    components: resolver,
    modules: loadModules(root),
  });
  if (!schematic.ir) {
    return { ok: false, error: schematic.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  }
  const view = parseView(source.text, { file: source.file });
  if (!view.ir) {
    return { ok: false, error: view.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  }

  const symbols = loadSymbolLibrary(root);
  const instances = schematicInstances(
    schematic.ir as Schematic,
    (componentId) => resolver.resolve(componentId)?.pins ?? [],
    (componentId) => shards.find((shard) => shard.id === componentId)?.ir.component.symbol,
    symbols,
    (componentId): DeviceFacts | undefined => {
      const component = shards.find((shard) => shard.id === componentId)?.ir.component;
      if (component === undefined) return undefined;
      return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
    },
  );
  const composition = loadPageComposition(root, view.ir, symbols, { resolver, shards });
  if (composition.errors.length > 0) return { ok: false, error: pageCompositionError(composition.errors) };
  const geometry = composedGeometry(composition.view, instances, composition.composition);
  // An endpoint is an identity, not a coordinate: a pin, a port this page draws, a module port,
  // or a junction this page declares (spec/schematic-view.md §5). All four resolve to their point.
  const endpointPoints = new Map<string, { x_nm: number; y_nm: number }>([
    ...(view.ir.port ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
    ...(view.ir.junction ?? []).map((junction) => [junction.id, { x_nm: junction.x_nm, y_nm: junction.y_nm }] as const),
  ]);
  const modulePortPoints = new Map(geometry.modulePortPoints ?? []);

  const rewired: string[] = [];
  const conflicts: string[] = [];
  const changed: { index: number; wire: NonNullable<typeof view.ir.wire>[number] }[] = [];
  (view.ir.wire ?? []).forEach((wire, index) => {
    const from = pinPoint(geometry, wire.from_pin, endpointPoints, modulePortPoints);
    const to = pinPoint(geometry, wire.to_pin, endpointPoints, modulePortPoints);
    if (!from || !to) {
      conflicts.push(`${wire.net} ${wire.from_pin} → ${wire.to_pin}: the pin is not on this page`);
      return;
    }
    const result = rerouteWire({
      net: wire.net,
      from_pin: typeof wire.from_pin === "string" ? wire.from_pin : "@coordinate",
      to_pin: typeof wire.to_pin === "string" ? wire.to_pin : "@coordinate",
      points: wire.points ?? [],
      from,
      to,
    });
    if (result.conflict !== undefined) {
      conflicts.push(`${wire.net} ${wire.from_pin} → ${wire.to_pin}: the wire's shape could not be kept (${result.conflict})`);
      return;
    }
    if (!result.changed) return;
    rewired.push(`${wire.net} ${wire.from_pin} → ${wire.to_pin}`);
    changed.push({ index, wire: { ...wire, points: result.points } });
  });

  if (changed.length === 0) {
    return { ok: true, value: { file: source.file, written: false, rewired, conflicts } };
  }

  const text = rewritePage(source.text, {
    file: source.file,
    sources: view.sources ?? new Map(),
    places: [],
    wires: changed,
    labels: [],
    ports: [],
  });
  if (!options.dryRun) {
    writeOut(`${root}/${source.file}`, text);
  }
  return { ok: true, value: { file: source.file, written: !options.dryRun, rewired, conflicts } };
}

/** Bring the page's wiring back onto its pins. Returns the process exit code. */
export function runViewRewire(options: ViewRewireOptions): number {
  const result = buildViewRewire(options);
  if (!result.ok) {
    console.error(result.error ?? "The page could not be rewired");
    return 2;
  }
  const value = result.value!;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    if (value.rewired.length === 0) process.stdout.write("No wire needed re-anchoring.\n");
    for (const wire of value.rewired) process.stdout.write(`rewired ${wire}\n`);
    for (const conflict of value.conflicts) process.stdout.write(`conflict ${conflict}\n`);
    if (value.written) process.stdout.write(`Wrote ${value.file}\n`);
  }
  return value.conflicts.length === 0 ? 0 : 1;
}

export interface ViewRenderOptions {
  readonly root: string;
  readonly page: string;
  /** Where the drawing is written; the default is under `dist/view/`. */
  readonly outFile?: string;
  readonly json: boolean;
}

export interface ViewRenderResult {
  /** The page's source file, relative to the project root. */
  readonly file: string;
  /** Where the drawing was written. */
  readonly svg_file: string;
  /** The drawing's size in bytes. */
  readonly bytes: number;
}

/**
 * The page as it is drawn, written as an SVG file.
 *
 * The drawing is the same one the review app shows: the same renderer, the same IR. What this
 * adds is a file a person can open, or a plugin can show, without a server running.
 */
export function buildViewRender(options: ViewRenderOptions): VerbResult<ViewRenderResult> {
  const { root, page } = options;
  const loaded = loadSchematic(root);
  if (!loaded) {
    return { ok: false, code: "cli.bad-usage", error: "Project root file not found: design/sch/main.teda" };
  }
  const source = loadViews(root).find((view) => view.pageId === page);
  if (!source) {
    const available = loadViews(root).map((view) => view.pageId).join(", ") || "none";
    return {
      ok: false,
      code: "cli.bad-usage",
      error: `Print page ${page} not found (available: ${available})`,
    };
  }
  const view = parseView(source.text, { file: source.file });
  const errors = view.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
  if (!view.ir) return { ok: false, error: errors.join("; ") || `Print page ${page} could not be parsed` };
  let svg: string;
  if (view.ir.template === undefined && (view.ir.module_place?.length ?? 0) === 0) {
    const drawn = renderPageSource(root, page, source.text);
    if (drawn.errors.length > 0) return { ok: false, error: drawn.errors.join("; ") };
    svg = drawn.svg;
  } else {
    const { resolver, shards } = loadComponents(root);
    const symbols = loadSymbolLibrary(root);
    const schematic = parseSchematic(loaded.text, {
      file: loaded.file,
      components: resolver,
      modules: loadModules(root),
    });
    if (!schematic.ir) return { ok: false, error: schematic.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
    const composition = loadPageComposition(root, view.ir, symbols, { resolver, shards });
    if (composition.errors.length > 0) return { ok: false, error: pageCompositionError(composition.errors) };
    const instances = schematicInstances(
      schematic.ir as Schematic,
      (componentId) => resolver.resolve(componentId)?.pins ?? [],
      (componentId) => shards.find((shard) => shard.id === componentId)?.ir.component.symbol,
      symbols,
      (componentId): DeviceFacts | undefined => {
        const component = shards.find((shard) => shard.id === componentId)?.ir.component;
        if (component === undefined) return undefined;
        return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
      },
    );
    try {
      const geometry = composedGeometry(composition.view, instances, composition.composition);
      const doc = renderComposedPage(composition.view, instances, composition.composition);
      svg = toSvgText(renderInterconnects(composition.view, doc, geometry.modulePortPoints));
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const svgFile = options.outFile ?? `dist/view/${page}.svg`;
  const path = isAbsolute(svgFile) ? svgFile : `${root}/${svgFile}`;
  writeOut(path, svg);
  return { ok: true, value: { file: source.file, svg_file: svgFile, bytes: Buffer.byteLength(svg, "utf8") } };
}

/** Write the page's drawing. Returns the process exit code. */
export function runViewRender(options: ViewRenderOptions): number {
  const result = buildViewRender(options);
  if (!result.ok) {
    console.error(result.error ?? "The page could not be drawn");
    return 2;
  }
  const value = result.value!;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`Wrote ${value.svg_file} (${value.bytes} bytes)\n`);
  }
  return 0;
}
