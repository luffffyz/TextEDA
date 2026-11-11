// The facts a module drawing is checked and edited against (ADR-0068 D2, ADR-0071 D2).
//
// A module drawing names the module definition's own instances and nets (`U1`, `VOUT`), not the
// project's flattened identities. The geometry behind an instance is the device's: its symbol draws
// the body and its component file names the pins (ADR-0031). This module builds that bridge once,
// for the review model that draws the drawing and for the layout planner that writes it.
import type { Component } from "@texteda/ir/component";
import type { Symbol } from "@texteda/ir/symbol";
import { PARAM_TYPE_KINDS, parseQuantity, parseSchematicDocument, type Document as ModuleDocument } from "@texteda/parser";
import { loadComponents, loadModules } from "./project.ts";
import {
  instanceValueText,
  loadSymbolLibrary,
  type DeviceFacts,
  type SchematicInstances,
} from "./symbols.ts";

type ComponentFacts = Component["component"];

/** The device facts a module definition's instances need. */
export interface DeviceLookup {
  /** The device's own facts, as its component file declares them. */
  readonly componentOf: (componentId: string) => ComponentFacts | undefined;
  /** The device's pins: number, name and type. */
  readonly pinsOf: (componentId: string) => readonly { number: string; name: string; type: string }[];
  /** The symbol the device draws itself with. */
  readonly symbolOf: (componentId: string) => string | undefined;
  /** The device's parameters and its MPN. */
  readonly deviceOf: (componentId: string) => DeviceFacts | undefined;
  /** The project's symbol library. */
  readonly symbols: ReadonlyMap<string, Symbol>;
}

/** A module definition, its instances, and its port-to-net bindings. */
export interface ModuleFacts {
  /** The parsed module definition. */
  readonly document: ModuleDocument;
  /** The module's instances, as the renderer needs them. */
  readonly instances: SchematicInstances;
  /** A module port id to the module-local net it names. */
  readonly portNets: Map<string, string>;
  /** The module's local nets and their members. */
  readonly nets: { id: string; members: string[] }[];
}

/**
 * Load one module definition with the facts a drawing needs.
 *
 * The module file stays authoritative: this reads it, it never writes it. A missing definition or a
 * definition that does not compile is an error for the caller to report, not something to guess.
 */
export function loadModuleFacts(root: string, moduleId: string): ModuleFacts {
  const source = loadModules(root).find((candidate) => candidate.moduleId === moduleId);
  if (source === undefined) throw new Error(`no such module: ${moduleId}`);
  const parsed = parseSchematicDocument(source.text, { file: source.file, kind: "module" });
  if (parsed.doc === undefined) {
    const first = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    throw new Error(`${source.file}: ${first ? `${first.code}: ${first.message}` : "the module definition does not parse"}`);
  }
  const facts = projectDeviceLookup(root);
  const portNets = new Map(parsed.doc.ports.map((port) => [port.id, port.net]));
  const nets = parsed.doc.nets.map((net) => ({ id: net.name, members: [...net.memberRefs] }));
  return { document: parsed.doc, instances: moduleInstances(parsed.doc, facts), portNets, nets };
}

/** The project's component and symbol facts, without parsing the project root. */
export function projectDeviceLookup(root: string): DeviceLookup {
  const { resolver, shards } = loadComponents(root);
  const symbols = loadSymbolLibrary(root);
  const componentOf = (componentId: string) => shards.find((shard) => shard.id === componentId)?.ir.component;
  return {
    componentOf,
    pinsOf: (componentId) => resolver.resolve(componentId)?.pins ?? [],
    symbolOf: (componentId) => componentOf(componentId)?.symbol,
    deviceOf: (componentId) => {
      const component = componentOf(componentId);
      if (component === undefined) return undefined;
      return {
        params: component.params ?? [],
        ...(component.mpn === undefined ? {} : { mpn: component.mpn }),
      };
    },
    symbols,
  };
}

/**
 * The module definition's own instances, as the renderer needs them (ADR-0068 D2).
 *
 * A module drawing names the module's local instances (`U1`), and the geometry behind an instance
 * is the device's: the symbol draws the body, the device names the pins (ADR-0031). An instance
 * whose device or symbol is unknown is left out — the module file's own check says so, and
 * geometry cannot be invented for it.
 */
export function moduleInstances(doc: ModuleDocument, facts: DeviceLookup): SchematicInstances {
  const instances: SchematicInstances = new Map();
  for (const instance of doc.instances) {
    const symbolRef = facts.symbolOf(instance.componentId);
    const symbol = symbolRef === undefined ? undefined : facts.symbols.get(symbolRef);
    if (symbol === undefined) continue;
    const value = moduleValue(instance, facts);
    instances.set(instance.refdes, {
      symbol: symbol.symbol,
      part: { pins: facts.pinsOf(instance.componentId).map((pin) => ({ ...pin })) },
      ...(value === undefined ? {} : { value }),
    });
  }
  return instances;
}

/**
 * The value a module instance prints, or nothing when the device has none (ADR-0024).
 *
 * The value is a fact of the instance row: the device's own value column, read with the type that
 * column declares. A part without a value column prints its MPN, exactly as the board's instances
 * do.
 */
function moduleValue(
  instance: ModuleDocument["instances"][number],
  facts: DeviceLookup,
): string | undefined {
  const device = facts.deviceOf(instance.componentId);
  // The rule the board's own instances use: a part without a value column prints its MPN.
  const none = instanceValueText(
    { id: instance.refdes, component: instance.componentId, params: [] },
    device,
  );
  const decls = facts.componentOf(instance.componentId)?.params ?? [];
  const index = decls.findIndex((decl) => decl.name === "value");
  if (index < 0) return none;
  const cell = instance.paramCells[index];
  if (cell === undefined) return none;
  const decl = decls[index]!;
  const param = decl.type === "string"
    ? { name: "value", text: cell }
    : quantityParam(cell, decl.type);
  if (param === undefined) return none;
  return instanceValueText(
    { id: instance.refdes, component: instance.componentId, params: [param] },
    device,
  );
}

/** The value column read as the quantity its type declares; nothing when the cell does not parse. */
function quantityParam(cell: string, type: string): { name: string; value: number } | undefined {
  const kind = PARAM_TYPE_KINDS[type];
  if (kind === undefined) return undefined;
  const parsed = parseQuantity(cell, kind, { code: "value.invalid-param" });
  return parsed.ok ? { name: "value", value: parsed.value } : undefined;
}
