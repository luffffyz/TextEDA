// sch ↔ pcb binding validation (`spec/pcb.md` §5.2 rules 1–5).
//
// This is the landing spot for core invariants #12/#13: the two descriptions evolve
// independently, but logical connectivity has a single source of truth.
// pcb's `connect` declares "there is continuous copper between these two pads"; it must
// fall inside the same net in sch;
// conversely, every sch net's members must be covered by `connect` (otherwise it is
// "logically connected, physically no copper").
//
// Pure functions: they only consume the two IRs, touch no filesystem and know no syntax.
// So LSP, exporters and `check` all use the same rules.
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Pcb } from "@texteda/ir/pcb";
import type { Schematic } from "@texteda/ir/schematic";

export interface BindingFacts {
  /** File name of the pcb description, used for locating (the IR only stores the file's first line). */
  file: string;
  schematic: Schematic;
  pcb: Pcb;
}

/** Extract the instance id from a pad reference (`<instance>.<pin>`): split at the **last** `.` (instance ids may contain `.`). */
export function instanceOf(ref: string): string {
  const dot = ref.lastIndexOf(".");
  return dot === -1 ? ref : ref.slice(0, dot);
}

/** All net references appearing in pcb (every section besides `connect`). */
function referencedNets(pcb: Pcb): string[] {
  const nets: string[] = [];
  for (const trace of pcb.trace ?? []) nets.push(trace.net);
  for (const via of pcb.via ?? []) nets.push(via.net);
  for (const zone of pcb.zone ?? []) nets.push(zone.net);
  for (const rule of pcb.rules) {
    if (rule.type === "net") nets.push(rule.net);
    if (rule.type === "diff" || rule.type === "match") nets.push(rule.net_a, rule.net_b);
  }
  for (const item of pcb.physical_only ?? []) {
    if (item.type === "stitching") nets.push(item.net);
  }
  for (const deviation of pcb.deviation ?? []) {
    if (deviation.type === "net_tie") nets.push(deviation.net_a, deviation.net_b);
    else nets.push(deviation.net);
  }
  return nets;
}

/**
 * Run the binding rules, return diagnostics.
 *
 * Rules (`spec/pcb.md` §5.2):
 * 1. instances in `place` must exist in the flattened sch result;
 * 2. pads in `connect` must belong to placed instances;
 * 3. a pair of pads in `connect` must be inside the same sch net — unless overridden by `deviation.net_tie`;
 * 4. each sch net's members (placed instances only) must appear in at least one `connect` pair;
 * 5. nets referenced by pcb must exist in sch;
 * 6. every physical instance of sch must be placed (a partial layout is legal, but it is reported: ADR-0040).
 */
export function checkBinding(facts: BindingFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const at = { file: facts.file, line: 1, col: 1 };

  const schInstances = new Set(facts.schematic.instances.map((instance) => instance.id));
  const placed = new Set(facts.pcb.place.map((item) => item.instance_id));

  // Rule 1: instances in place must exist.
  for (const item of facts.pcb.place) {
    if (schInstances.has(item.instance_id)) continue;
    diagnostics.push({
      code: "bind.unknown-instance",
      severity: "error",
      message: `instance ${item.instance_id} in place does not exist in the sch result`,
      location: at,
      hint: "instance ids are the board's refdes (R1); run check first to see whether the sch side already reports an error",
      data: { instance_id: item.instance_id },
    });
  }

  // Rule 6 (ADR-0040): every physical instance must be placed. A partial layout is a normal
  // work state, so this is a warning, and it is one diagnostic per board: "9 of 61 placed" is
  // a fact about the description, not 52 facts about 52 instances. `logical_only` instances
  // have no physical entity; a DNP part still has a land pattern, so it counts (D6).
  const physical = facts.schematic.instances.filter((instance) => instance.logical_only !== true);
  const unplaced = physical.filter((instance) => !placed.has(instance.id)).map((instance) => instance.id);
  if (unplaced.length > 0) {
    const shown = unplaced.slice(0, 8).join(", ");
    const more = unplaced.length > 8 ? `, … (${unplaced.length - 8} more)` : "";
    diagnostics.push({
      code: "bind.instance-unplaced",
      severity: "warning",
      message: `the pcb places ${physical.length - unplaced.length} of the board's ${physical.length} instances; ${unplaced.length} not placed: ${shown}${more}`,
      location: at,
      expected: `every physical instance of the sch result has a place (${physical.length})`,
      actual: `${physical.length - unplaced.length} placed`,
      hint: "place the missing instances; a partial layout is legal and this warning is how it says so",
      data: { placed: physical.length - unplaced.length, total: physical.length, unplaced: unplaced.length },
    });
  }

  // pin → net (only looking at flattened sch members).
  const pinNet = new Map<string, string>();
  const netMembers = new Map<string, string[]>();
  for (const net of facts.schematic.nets) {
    for (const member of net.members) {
      pinNet.set(member, net.id);
      const list = netMembers.get(net.id) ?? [];
      list.push(member);
      netMembers.set(net.id, list);
    }
  }

  // net_tie: allows two sch nets to be physically shorted.
  const tied = new Set<string>();
  for (const deviation of facts.pcb.deviation ?? []) {
    if (deviation.type !== "net_tie") continue;
    tied.add(deviation.net_a < deviation.net_b ? `${deviation.net_a}|${deviation.net_b}` : `${deviation.net_b}|${deviation.net_a}`);
  }

  // Declared deviations enter the report (ADR-0035 D10): a net tie is a note, a split ground is a warning.
  for (const deviation of facts.pcb.deviation ?? []) {
    if (deviation.type === "net_tie") {
      diagnostics.push({
        code: "bind.net-tie",
        severity: "note",
        message: `net_tie shorts two sch nets: ${deviation.net_a} and ${deviation.net_b}`,
        location: at,
        hint: "a tie changes the connectivity of both nets; check that this is the one you meant",
        data: { net_a: deviation.net_a, net_b: deviation.net_b },
      });
    } else if (deviation.type === "split_ground") {
      diagnostics.push({
        code: "bind.split-ground",
        severity: "warning",
        message: `net ${deviation.net} is physically split into regions that do not touch`,
        location: at,
        hint: "a split ground breaks the return path of every signal that crosses the gap; check the isolation and the stitching",
        data: { net: deviation.net },
      });
    }
  }

  const covered = new Set<string>();
  for (const edge of facts.pcb.connect) {
    for (const ref of [edge.a, edge.b]) {
      const instance = instanceOf(ref);
      if (!placed.has(instance)) {
        diagnostics.push({
          code: "bind.pad-unplaced",
          severity: "error",
          message: `connect references the pad of an unplaced instance: ${ref}`,
          location: at,
          hint: "place this instance in the place section first, or delete this connect",
          data: { pad: ref, instance_id: instance },
        });
        continue;
      }
      covered.add(ref);
    }

    const netA = pinNet.get(edge.a);
    const netB = pinNet.get(edge.b);
    if (netA === undefined || netB === undefined) {
      const missing = netA === undefined ? edge.a : edge.b;
      diagnostics.push({
        code: "bind.unconnected-pad",
        severity: "error",
        message: `pad ${missing} in connect does not belong to any net in sch`,
        location: at,
        hint: "the pin is not connected to a net in sch: connect it to a net, or mark it as no_connect in the component file",
        data: { pad: missing },
      });
      continue;
    }
    if (netA === netB) continue;
    const key = netA < netB ? `${netA}|${netB}` : `${netB}|${netA}`;
    if (tied.has(key)) continue;
    diagnostics.push({
      code: "bind.net-mismatch",
      severity: "error",
      message: `connect shorts net ${netA} (${edge.a}) to net ${netB} (${edge.b})`,
      location: at,
      hint: "only pads of the same net may be connected; if you really want a short, write deviation net_tie",
      data: { a: edge.a, b: edge.b, net_a: netA, net_b: netB },
    });
  }

  // Rule 4: every net's placed members must be covered by connect.
  for (const [net, members] of netMembers) {
    const onBoard = members.filter((member) => placed.has(instanceOf(member)));
    if (onBoard.length === 0) continue;
    const missing = onBoard.filter((member) => !covered.has(member));
    if (missing.length === 0) continue;
    diagnostics.push({
      code: "bind.unrouted",
      severity: "warning",
      message: `net ${net} has ${missing.length} pads that do not appear in connect (unrouted)`,
      location: at,
      hint: "add the pad pairs in the connect section; this warning can be ignored while routing",
      data: { net, missing: missing.length, total: onBoard.length },
    });
  }

  // Rule 5: pcb must not reference nets that do not exist in sch.
  const schNets = new Set(facts.schematic.nets.map((net) => net.id));
  const reported = new Set<string>();
  for (const net of referencedNets(facts.pcb)) {
    if (schNets.has(net) || reported.has(net)) continue;
    reported.add(net);
    diagnostics.push({
      code: "bind.unknown-net",
      severity: "error",
      message: `pcb references a net that does not exist in sch: ${net}`,
      location: at,
      hint: "net names are the board's net names (GND, BUCK_VFB); pcb cannot create new logical connections",
      data: { net },
    });
  }

  return diagnostics;
}
