// `texteda view-metrics <project dir> <board>/<page>` — what a print page measures.
//
// An agent drawing a page iterates against numbers, not against pixels: the warnings say whether a
// label sits on its net, these numbers say how far off it is, how crowded the page is and where the
// wires pile up. Same geometry as the checks (`packages/renderer`'s `schematicGeometry`), so the
// metric and the warning can never disagree about where something is.
//
// Integer nanometres and ppm ratios only (ADR-0004): two runs, two machines, one table.
import { parseSchematic, parseView } from "@texteda/parser";
import type { Schematic } from "@texteda/ir/schematic";
import { schematicGeometry } from "@texteda/renderer";
import { viewMetrics, type ViewMetrics } from "@texteda/core";
import { loadBoard, loadComponents, loadModules } from "./project.ts";
import { loadSymbolLibrary, schematicInstances } from "./symbols.ts";

export interface ViewMetricsOptions {
  readonly root: string;
  /** Board id. */
  readonly board: string;
  /** Print page id. */
  readonly page: string;
  readonly json: boolean;
}

/** `board/page` -> its two halves; a page id cannot contain a slash. */
export function splitPageRef(ref: string): { board: string; page: string } | null {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { board: ref.slice(0, slash), page: ref.slice(slash + 1) };
}

/** Millimetres with one decimal, from nanometres: readable without losing the order of magnitude. */
function mm(nm: number): string {
  return (nm / 1_000_000).toFixed(1);
}

function format(metrics: ViewMetrics): string {
  const lines: string[] = [];
  lines.push(`${metrics.board}/${metrics.page} — ${mm(metrics.sheet.width_nm)} × ${mm(metrics.sheet.height_nm)} mm sheet`);
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

/** Print the page's metrics. Returns the process exit code. */
export function runViewMetrics(options: ViewMetricsOptions): number {
  const { root, board, page, json } = options;
  const loaded = loadBoard(root, board);
  if (!loaded) {
    console.error(`Board root file not found: design/sch/${board}.teda`);
    return 2;
  }
  const source = loaded.views.find((view) => view.pageId === page);
  if (!source) {
    const available = loaded.views.map((view) => view.pageId).join(", ") || "none";
    console.error(`Print page ${page} not found for board ${board} (available: ${available})`);
    return 2;
  }

  const { resolver, shards } = loadComponents(root);
  const schematic = parseSchematic(loaded.text, {
    file: loaded.file,
    board,
    components: resolver,
    modules: loadModules(root),
  });
  if (!schematic.ir) {
    for (const diagnostic of schematic.diagnostics) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
    return 1;
  }
  const view = parseView(source.text, { file: source.file, board });
  if (!view.ir) {
    for (const diagnostic of view.diagnostics) {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
    return 1;
  }

  // Geometry is measured on the board's own instances: a page that places an unknown instance is
  // the cross-check's finding, and measuring the rest of the page is still honest.
  const instances = schematicInstances(
    schematic.ir as Schematic,
    (componentId) => resolver.resolve(componentId)?.pins ?? [],
    (componentId) => shards.find((shard) => shard.id === componentId)?.ir.component.symbol,
    loadSymbolLibrary(root),
  );
  const metrics = viewMetrics({
    view: view.ir,
    schematic: schematic.ir,
    geometry: schematicGeometry(view.ir, instances),
  });

  process.stdout.write(json ? `${JSON.stringify(metrics, null, 2)}\n` : format(metrics));
  return 0;
}
