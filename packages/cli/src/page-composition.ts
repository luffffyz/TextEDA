import { parseModuleView, parseSchematicDocument, parseSheetTemplate } from "@texteda/parser";
import type { SchematicView } from "@texteda/ir/schematic-view";
import type { ModuleView } from "@texteda/ir/module-view";
import type { SheetTemplate } from "@texteda/ir/sheet-template";
import type { Symbol } from "@texteda/ir/symbol";
import type { ModuleDrawingInstances, PageComposition } from "@texteda/renderer";
import { moduleSchematicInstances, type DeviceFacts } from "./symbols.ts";
import { loadComponents, loadModuleViews, loadModules, loadSheetTemplates } from "./project.ts";

/** The parsed page and the reusable view facts required to render or measure it. */
export interface LoadedPageComposition {
  /** Template-backed pages use the template's declared size as their effective extent. */
  readonly view: SchematicView;
  readonly composition: PageComposition;
  /** Invalid or missing referenced artifacts; callers report these without inventing geometry. */
  readonly errors: readonly string[];
}

/**
 * Load just the reusable artifacts a page references (ADR-0068).
 *
 * Template dimensions are the page extent; each module drawing retains its independent local bounds.
 * Electrical facts remain in the module definition and project schematic, never in the view artifacts.
 */
export function loadPageComposition(
  root: string,
  view: SchematicView,
  symbols: ReadonlyMap<string, Symbol>,
  components: Pick<ReturnType<typeof loadComponents>, "resolver" | "shards">,
): LoadedPageComposition {
  const { resolver, shards } = components;
  const symbolOf = (componentId: string): string | undefined =>
    shards.find((shard) => shard.id === componentId)?.ir.component.symbol;
  const deviceOf = (componentId: string): DeviceFacts | undefined => {
    const component = shards.find((shard) => shard.id === componentId)?.ir.component;
    if (component === undefined) return undefined;
    return { params: component.params ?? [], ...(component.mpn === undefined ? {} : { mpn: component.mpn }) };
  };
  const paramsOf = (componentId: string) =>
    shards.find((shard) => shard.id === componentId)?.ir.component.params ?? [];

  const errors: string[] = [];
  const drawings = new Map<string, ModuleView>();
  const moduleInstances = new Map<string, ModuleDrawingInstances>();
  const modules = new Map(loadModules(root).map((source) => [source.moduleId, source]));
  const drawingSources = new Map(loadModuleViews(root).map((source) => [source.moduleId, source]));
  const moduleIds = [...new Set((view.module_place ?? []).map((placement) => placement.module_id))].sort();
  for (const moduleId of moduleIds) {
    const source = drawingSources.get(moduleId);
    if (source === undefined) {
      errors.push(`the page places the module ${moduleId}, which has no drawing`);
      continue;
    }
    const parsedDrawing = parseModuleView(source.text, { file: source.file });
    if (parsedDrawing.ir === undefined) {
      errors.push(...parsedDrawing.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`));
      continue;
    }
    if (parsedDrawing.ir.module_id !== moduleId) {
      errors.push(`module drawing ${source.file} identifies ${parsedDrawing.ir.module_id}, not ${moduleId}`);
      continue;
    }
    const definition = modules.get(moduleId);
    if (definition === undefined) {
      errors.push(`module drawing ${moduleId} has no usable module definition`);
      continue;
    }
    const parsedDefinition = parseSchematicDocument(definition.text, { file: definition.file, kind: "module" });
    if (parsedDefinition.doc === undefined) {
      errors.push(`module drawing ${moduleId} has no usable module definition`);
      continue;
    }
    const localInstances = moduleSchematicInstances(
      parsedDefinition.doc,
      (componentId) => resolver.resolve(componentId)?.pins ?? [],
      symbolOf,
      symbols,
      deviceOf,
      paramsOf,
    );
    for (const place of parsedDrawing.ir.place) {
      if (!localInstances.has(place.instance_id)) {
        errors.push(`module drawing ${moduleId} places ${place.instance_id}, which has no usable symbol facts`);
      }
    }
    drawings.set(moduleId, parsedDrawing.ir);
    moduleInstances.set(moduleId, localInstances);
  }

  let template: SheetTemplate | undefined;
  if (view.template !== undefined) {
    const source = loadSheetTemplates(root).find((candidate) => candidate.templateId === view.template);
    if (source === undefined) {
      errors.push(`the page names the template ${view.template}, which the project does not have`);
    } else {
      const parsed = parseSheetTemplate(source.text, { file: source.file });
      if (parsed.ir === undefined) {
        errors.push(...parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`));
      } else if (parsed.ir.template_id !== view.template) {
        errors.push(`sheet template ${source.file} identifies ${parsed.ir.template_id}, not ${view.template}`);
      } else {
        template = parsed.ir;
      }
    }
  }

  const effectiveView = template === undefined ? view : { ...view, sheet: template.size };
  return {
    view: effectiveView,
    composition: {
      ...(template === undefined ? {} : { template }),
      drawings,
      moduleInstances,
    },
    errors,
  };
}

export function pageCompositionError(errors: readonly string[]): string {
  return errors.join("; ");
}
