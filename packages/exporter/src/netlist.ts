// Netlist: the **connectivity projection** of the schematic IR.
//
// Carries only topology: net → member pins, plus the instance table (id → component).
// Values, tolerances, and footprints belong to the BOM and stay out — the authoritative
// part of a netlist is "what is wired to what"; mixing in part selection lets the two
// derived artifacts drift apart (AGENTS.md §7 "duplicate description" pitfall).
//
// The output must be a deterministic function of the IR: the same IR yields a
// byte-identical netlist, with no timestamps and no tool versions.
import type { Schematic } from "@texteda/ir/schematic";
import { byteCompare, pinRefCompare } from "@texteda/ir/order";

export interface NetlistComponent {
  /** The board's instance id (the refdes). */
  id: string;
  /** Component id (the file name under `components/`). */
  component: string;
}

export interface NetlistNet {
  id: string;
  members: string[];
}

export interface NetlistPort {
  id: string;
  net: string;
}

export interface Netlist {
  ir_version: string;
  board: string;
  components: NetlistComponent[];
  nets: NetlistNet[];
  ports: NetlistPort[];
}

/** Extract a netlist from the schematic IR. Nets and members are both sorted so the same set comes out regardless of source order. */
export function toNetlist(ir: Schematic): Netlist {
  const components: NetlistComponent[] = ir.instances
    .map((instance) => ({ id: instance.id, component: instance.component }))
    .sort((a, b) => byteCompare(a.id, b.id));

  const nets: NetlistNet[] = ir.nets
    .map((net) => ({ id: net.id, members: [...net.members].sort(pinRefCompare) }))
    .sort((a, b) => byteCompare(a.id, b.id));

  const ports: NetlistPort[] = (ir.ports ?? [])
    .map((port) => ({ id: port.id, net: port.net }))
    .sort((a, b) => byteCompare(a.id, b.id));

  return { ir_version: ir.ir_version, board: ir.board, components, nets, ports };
}

/**
 * Human-readable form: one net per line, members sorted and space-separated;
 * the instance table goes last.
 *
 * No column alignment: net names vary too much in length, so alignment only adds
 * padding whitespace; for clean diffs use `--json` (fixed field order).
 */
export function formatNetlist(netlist: Netlist): string {
  const lines: string[] = [`# netlist ${netlist.board} (ir ${netlist.ir_version})`];
  for (const net of netlist.nets) {
    lines.push(`${net.id}: ${net.members.join(" ")}`);
  }
  if (netlist.ports.length > 0) {
    lines.push("");
    for (const port of netlist.ports) lines.push(`port ${port.id}: ${port.net}`);
  }
  lines.push("");
  lines.push(`# components ${netlist.components.length}`);
  for (const component of netlist.components) lines.push(`${component.id} ${component.component}`);
  return `${lines.join("\n")}\n`;
}
