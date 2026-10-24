// Build the facts the procurement rules work on (`spec/procurement.md`, ADR-0030).
//
// The facts come from three places: the board's design (which lines exist and who uses them),
// the procurement files (which parts are bought) and the device library (what the devices are).
// This module only reads them; the rules themselves live in `packages/core`, so the checker, the
// BOM builder and (later) the LSP agree on what a selection means.
import type { DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { Procurement } from "@texteda/ir/procurement";
import type { DesignLine, Device, ProcurementFacts, Selection } from "@texteda/core";

/** The parameter values of an instance or a selection, keyed by role. */
function paramMap(params: readonly { name: string; value?: number; text?: string }[]): Record<string, number | string> {
  const map: Record<string, number | string> = {};
  for (const param of params) {
    map[param.name] = param.value ?? param.text ?? "";
  }
  return map;
}

/** The line key: the device id plus the values that distinguish it from another line. */
function lineKey(component: string, params: Readonly<Record<string, number | string>>): string {
  const roles = Object.keys(params).sort();
  return JSON.stringify([component, roles.map((role) => [role, params[role]])]);
}

export interface ProcurementFactsInput {
  /** The board's schematic IR. */
  schematic: Schematic;
  /** The procurement shards of the board, primary first. */
  procurements: readonly {
    ir: Procurement;
    file: string;
    locate?: (irPath: string) => DiagnosticLocation | undefined;
  }[];
  /** The devices, id → facts. */
  devices: ReadonlyMap<string, Device>;
  /** Where an instance was written (ADR-0020 D1: the IR carries no line numbers). */
  locateInstance?: (instanceId: string) => DiagnosticLocation | undefined;
}

/**
 * The board's design lines: the generic (or part) lines the design uses.
 *
 * A line is a device plus the values it was given: two 10k resistors with different tolerances
 * are two lines. An instance that is not placed (DNP) or has no physical entity (logical only)
 * is not a line — nothing is bought for it.
 */
export function designLines(
  schematic: Schematic,
  /** Where an instance was written: the IR no longer carries line numbers (ADR-0020 D1). */
  locateInstance?: (instanceId: string) => DiagnosticLocation | undefined,
): DesignLine[] {
  const lines = new Map<string, DesignLine>();
  for (const instance of schematic.instances) {
    if (instance.dnp === true) continue;
    if (instance.logical_only === true) continue;
    const params = paramMap(instance.params ?? []);
    const key = lineKey(instance.component, params);
    const existing = lines.get(key);
    if (existing) {
      lines.set(key, { ...existing, instances: [...existing.instances, instance.id] });
      continue;
    }
    lines.set(key, {
      component: instance.component,
      params,
      instances: [instance.id],
      location: locateInstance?.(instance.id) ?? {
        file: schematic.source?.file ?? "",
        line: 1,
        col: 1,
      },
    });
  }
  return [...lines.values()];
}

/** The selection rows of the procurement shards. */
export function selections(
  procurements: readonly {
    ir: Procurement;
    file: string;
    locate?: (irPath: string) => DiagnosticLocation | undefined;
  }[],
): Selection[] {
  const out: Selection[] = [];
  for (const { ir, file, locate } of procurements) {
    for (const [index, selection] of ir.procurement.selections.entries()) {
      out.push({
        generic: selection.generic,
        params: paramMap(selection.params ?? []),
        part: selection.not_required === true ? null : (selection.part ?? null),
        role: ir.procurement.role,
        location: locate?.(`/procurement/selections/${index}`) ?? { file, line: 1, col: 1 },
      });
    }
  }
  return out;
}

/** The facts of one board's procurement state. */
export function buildProcurementFacts(input: ProcurementFactsInput): ProcurementFacts {
  return {
    lines: designLines(input.schematic, input.locateInstance),
    selections: selections(input.procurements),
    devices: input.devices,
  };
}
