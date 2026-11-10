// Project schematic ↔ PCB binding validation (spec/pcb.md §5.2).
//
// The project root owns logical connectivity. Each PCB owns a disjoint set of
// module instances, and its `connect` section owns only that PCB's copper.
// These checks are pure: callers provide parsed IR and optional source locators.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Pcb } from "@texteda/ir/pcb";
import type { Instance, Net } from "@texteda/ir/schematic";

export interface BindingModulePort {
  id: string;
  net?: string;
  pins: readonly string[];
}

export interface BindingModule {
  instance_id: string;
  module_id: string;
  ports: readonly BindingModulePort[];
}

export interface BindingInterconnect {
  id: string;
  from: string;
  to: string;
}

export interface BindingInterconnectPin {
  interconnect: string;
  from: string;
  to: string;
}

/** v0.19 project-root schematic facts needed by PCB binding checks. */
export interface BindingSchematic {
  project: string;
  modules: readonly BindingModule[];
  instances: readonly Pick<Instance, "id" | "logical_only">[];
  nets: readonly Pick<Net, "id" | "members">[];
  interconnects?: readonly BindingInterconnect[];
  interconnect_pins?: readonly BindingInterconnectPin[];
}

/** v0.19 PCB IR: existing physical facts plus explicit PCB identity and ownership. */
export type BindingPcb = Omit<Pcb, "board"> & {
  pcb: string;
  modules: readonly string[];
};

export interface BindingPcbFacts {
  /** File name of this PCB description. */
  file: string;
  pcb: BindingPcb;
  /** A PCB record's IR path (`/connect/3`) → where it was written. */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
  /** A project net's id → the row that declares it. */
  readonly locateNet?: (netId: string) => DiagnosticLocation | undefined;
}

/** Facts for checking one project root against all of its physical PCB implementations. */
export interface BindingFacts {
  schematic: BindingSchematic;
  pcbs: readonly BindingPcbFacts[];
  /** Project root file, used for project-wide findings when no source span is available. */
  file?: string;
  /** A root schematic IR path → where it was written. */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
}

/** Extract the instance id from a pad reference (`<instance>.<pin>`). */
export function instanceOf(ref: string): string {
  const dot = ref.lastIndexOf(".");
  return dot === -1 ? ref : ref.slice(0, dot);
}

/** Extract the module-instance prefix from a flattened instance or pad reference. */
function moduleOf(ref: string): string | undefined {
  const dot = ref.indexOf(".");
  return dot === -1 ? undefined : ref.slice(0, dot);
}

/** All net references appearing in a PCB (every section besides `connect`). */
function referencedNets(pcb: BindingPcb): string[] {
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

type OwnerMap = Map<string, BindingPcbFacts[]>;

function addError(
  diagnostics: Diagnostic[],
  code: Diagnostic["code"],
  location: DiagnosticLocation,
  message: string,
  data: Record<string, string | number | boolean>,
): void {
  diagnostics.push({ code, severity: "error", message, location, data });
}

/** Validate one PCB against the root, retaining all existing within-PCB rules. */
function checkPcb(
  schematic: BindingSchematic,
  boardFacts: BindingPcbFacts,
  owners: OwnerMap,
  diagnostics: Diagnostic[],
): void {
  const pcb = boardFacts.pcb;
  const fileOnly: DiagnosticLocation = { file: boardFacts.file, line: 1, col: 1 };
  const at = (irPath: string): DiagnosticLocation => boardFacts.locate?.(irPath) ?? fileOnly;
  const netRows = (netId: string): { related?: DiagnosticLocation[] } => {
    const row = boardFacts.locateNet?.(netId);
    return row === undefined ? {} : { related: [row] };
  };
  const schInstances = new Set(schematic.instances.map((instance) => instance.id));
  const ownedModules = new Set(pcb.modules);
  const placed = new Set<string>();

  // Rule 1: placements must resolve to the root and to this PCB's ownership set.
  for (const [index, item] of pcb.place.entries()) {
    const moduleId = moduleOf(item.instance_id);
    if (!schInstances.has(item.instance_id)) {
      addError(diagnostics, "bind.unknown-instance", at(`/place/${index}`), `instance ${item.instance_id} in place does not exist in the project sch result`, { instance_id: item.instance_id, pcb: pcb.pcb });
      continue;
    }
    if (moduleId === undefined || !ownedModules.has(moduleId)) {
      addError(diagnostics, "bind.instance-not-owned", at(`/place/${index}`), `instance ${item.instance_id} in place is not owned by PCB ${pcb.pcb}`, { instance_id: item.instance_id, module_id: moduleId ?? "", pcb: pcb.pcb });
      continue;
    }
    placed.add(item.instance_id);
  }

  // A partial layout is legal, so this remains one warning per PCB rather than one finding per part.
  const physical = schematic.instances.filter((instance) => {
    if (instance.logical_only === true) return false;
    const moduleId = moduleOf(instance.id);
    const moduleOwners = moduleId === undefined ? undefined : owners.get(moduleId);
    return moduleOwners?.length === 1 && moduleOwners[0]! === boardFacts;
  });
  const unplaced = physical.filter((instance) => !placed.has(instance.id)).map((instance) => instance.id);
  if (unplaced.length > 0) {
    const shown = unplaced.slice(0, 8).join(", ");
    const more = unplaced.length > 8 ? `, … (${unplaced.length - 8} more)` : "";
    diagnostics.push({
      code: "bind.instance-unplaced",
      severity: "warning",
      message: `PCB ${pcb.pcb} places ${physical.length - unplaced.length} of its ${physical.length} physical instances; ${unplaced.length} not placed: ${shown}${more}`,
      location: fileOnly,
      expected: `every physical instance owned by PCB ${pcb.pcb} has a place (${physical.length})`,
      actual: `${physical.length - unplaced.length} placed`,
      hint: "place the missing instances; a partial layout is legal and this warning is how it says so",
      data: { pcb: pcb.pcb, placed: physical.length - unplaced.length, total: physical.length, unplaced: unplaced.length },
    });
  }

  const pinNet = new Map<string, string>();
  const netMembers = new Map<string, string[]>();
  for (const net of schematic.nets) {
    for (const member of net.members) {
      pinNet.set(member, net.id);
      const list = netMembers.get(net.id) ?? [];
      list.push(member);
      netMembers.set(net.id, list);
    }
  }

  const tied = new Set<string>();
  for (const deviation of pcb.deviation ?? []) {
    if (deviation.type !== "net_tie") continue;
    tied.add(deviation.net_a < deviation.net_b ? `${deviation.net_a}|${deviation.net_b}` : `${deviation.net_b}|${deviation.net_a}`);
  }

  // Declared deviations enter the report (ADR-0014 D10).
  for (const [index, deviation] of (pcb.deviation ?? []).entries()) {
    if (deviation.type === "net_tie") {
      diagnostics.push({
        code: "bind.net-tie",
        severity: "note",
        message: `net_tie shorts two project nets: ${deviation.net_a} and ${deviation.net_b}`,
        location: at(`/deviation/${index}`),
        hint: "a tie changes the connectivity of both nets; check that this is the one you meant",
        data: { net_a: deviation.net_a, net_b: deviation.net_b },
      });
    } else if (deviation.type === "split_ground") {
      diagnostics.push({
        code: "bind.split-ground",
        severity: "warning",
        message: `net ${deviation.net} is physically split into regions that do not touch`,
        location: at(`/deviation/${index}`),
        hint: "a split ground breaks the return path of every signal that crosses the gap; check the isolation and the stitching",
        data: { net: deviation.net },
      });
    }
  }

  const covered = new Set<string>();
  for (const [index, edge] of pcb.connect.entries()) {
    let valid = true;
    for (const ref of [edge.a, edge.b]) {
      const instance = instanceOf(ref);
      const moduleId = moduleOf(instance);
      if (!schInstances.has(instance)) {
        addError(diagnostics, "bind.pad-unplaced", at(`/connect/${index}`), `connect references a pad of an unknown instance: ${ref}`, { pad: ref, instance_id: instance, pcb: pcb.pcb });
        valid = false;
      } else if (moduleId === undefined || !ownedModules.has(moduleId)) {
        addError(diagnostics, "bind.pad-unplaced", at(`/connect/${index}`), `connect references a pad owned by another PCB: ${ref}`, { pad: ref, instance_id: instance, pcb: pcb.pcb });
        valid = false;
      } else if (!placed.has(instance)) {
        addError(diagnostics, "bind.pad-unplaced", at(`/connect/${index}`), `connect references the pad of an unplaced instance: ${ref}`, { pad: ref, instance_id: instance, pcb: pcb.pcb });
        valid = false;
      }
    }
    if (!valid) continue;
    covered.add(edge.a);
    covered.add(edge.b);
    const netA = pinNet.get(edge.a);
    const netB = pinNet.get(edge.b);
    if (netA === undefined || netB === undefined) {
      const missing = netA === undefined ? edge.a : edge.b;
      diagnostics.push({
        code: "bind.unconnected-pad",
        severity: "error",
        message: `pad ${missing} in connect does not belong to any net in the project sch`,
        location: at(`/connect/${index}`),
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
      location: at(`/connect/${index}`),
      hint: "only pads of the same net may be connected; if you really want a short, write deviation net_tie",
      data: { a: edge.a, b: edge.b, net_a: netA, net_b: netB },
      ...netRows(netA),
    });
  }

  // Only members belonging to this PCB participate in its unrouted check.
  for (const [net, members] of netMembers) {
    const onBoard = members.filter((member) => {
      const moduleId = moduleOf(instanceOf(member));
      return moduleId !== undefined && ownedModules.has(moduleId) && placed.has(instanceOf(member));
    });
    if (onBoard.length === 0) continue;
    const missing = onBoard.filter((member) => !covered.has(member));
    if (missing.length === 0) continue;
    diagnostics.push({
      code: "bind.unrouted",
      severity: "warning",
      message: `net ${net} has ${missing.length} pads that do not appear in connect (unrouted on PCB ${pcb.pcb})`,
      location: fileOnly,
      hint: "add the pad pairs in the connect section; this warning can be ignored while routing",
      data: { pcb: pcb.pcb, net, missing: missing.length, total: onBoard.length },
      ...netRows(net),
    });
  }

  // PCB physical facts cannot invent a project net.
  const schNets = new Set(schematic.nets.map((net) => net.id));
  const reported = new Set<string>();
  for (const net of referencedNets(pcb)) {
    if (schNets.has(net) || reported.has(net)) continue;
    reported.add(net);
    diagnostics.push({
      code: "bind.unknown-net",
      severity: "error",
      message: `PCB ${pcb.pcb} references a net that does not exist in the project sch: ${net}`,
      location: fileOnly,
      hint: "net names are the project's flattened net names; a PCB cannot create new logical connections",
      data: { pcb: pcb.pcb, net },
    });
  }
}

interface ResolvedEndpoint {
  module: BindingModule;
  port: BindingModulePort;
  rootNet?: string;
}

/** Run project ownership, interconnect, and per-PCB binding checks. */
export function checkBinding(facts: BindingFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rootFile = facts.file ?? facts.pcbs[0]?.file ?? "design/sch/main.teda";
  const rootOnly: DiagnosticLocation = { file: rootFile, line: 1, col: 1 };
  const rootAt = (irPath: string): DiagnosticLocation => facts.locate?.(irPath) ?? rootOnly;
  const modules = new Map<string, BindingModule>();
  for (const module of facts.schematic.modules) modules.set(module.instance_id, module);

  // Build an owner map while diagnosing duplicate declarations and unknown modules.
  const owners: OwnerMap = new Map();
  for (const boardFacts of facts.pcbs) {
    const seen = new Set<string>();
    for (const [index, moduleId] of boardFacts.pcb.modules.entries()) {
      const at = (irPath: string): DiagnosticLocation => boardFacts.locate?.(irPath) ?? { file: boardFacts.file, line: 1, col: 1 };
      if (seen.has(moduleId)) {
        addError(diagnostics, "value.duplicate-instance", at(`/modules/${index}`), `PCB ${boardFacts.pcb.pcb} lists module instance ${moduleId} more than once`, { pcb: boardFacts.pcb.pcb, module_id: moduleId });
        continue;
      }
      seen.add(moduleId);
      if (!modules.has(moduleId)) {
        addError(diagnostics, "ref.unknown-module-instance", at(`/modules/${index}`), `PCB ${boardFacts.pcb.pcb} claims unknown project module instance ${moduleId}`, { pcb: boardFacts.pcb.pcb, module_id: moduleId });
        continue;
      }
      const list = owners.get(moduleId) ?? [];
      list.push(boardFacts);
      owners.set(moduleId, list);
    }
  }

  // Every root module must have one and only one physical owner.
  for (const [index, module] of facts.schematic.modules.entries()) {
    const moduleOwners = owners.get(module.instance_id) ?? [];
    if (moduleOwners.length === 0) {
      addError(diagnostics, "bind.instance-unowned", rootAt(`/modules/${index}`), `project module instance ${module.instance_id} has no PCB owner`, { module_id: module.instance_id });
    } else if (moduleOwners.length > 1) {
      diagnostics.push({
        code: "bind.instance-split",
        severity: "error",
        message: `project module instance ${module.instance_id} is claimed by multiple PCBs: ${moduleOwners.map((board) => board.pcb.pcb).join(", ")}`,
        location: rootAt(`/modules/${index}`),
        data: { module_id: module.instance_id, owners: moduleOwners.length },
        related: moduleOwners.map((board) => ({ file: board.file, line: 1, col: 1 })),
      });
    }
  }

  // Root flattened pin membership is the only authority for endpoint net identity.
  const pinNet = new Map<string, string>();
  const netRows = new Map<string, number>();
  for (const [index, net] of facts.schematic.nets.entries()) {
    netRows.set(net.id, index);
    for (const member of net.members) pinNet.set(member, net.id);
  }
  const endpoint = (ref: string, path: string): ResolvedEndpoint | undefined => {
    const dot = ref.indexOf(".");
    const moduleId = dot === -1 ? undefined : ref.slice(0, dot);
    const portId = dot === -1 ? undefined : ref.slice(dot + 1);
    const module = moduleId === undefined ? undefined : modules.get(moduleId);
    if (module === undefined) {
      addError(diagnostics, "ref.unknown-instance", rootAt(path), `interconnect endpoint ${ref} names an unknown project module instance`, { endpoint: ref });
      return undefined;
    }
    const port = module.ports.find((candidate) => candidate.id === portId);
    if (port === undefined) {
      addError(diagnostics, "ref.unknown-port", rootAt(path), `interconnect endpoint ${ref} names a port not declared by module instance ${module.instance_id}`, { endpoint: ref, module_id: module.instance_id, port_id: portId ?? "" });
      return undefined;
    }
    if (port.net === undefined) {
      addError(diagnostics, "ref.unbound-port", rootAt(path), `interconnect endpoint ${ref} has no declared module-local net`, { endpoint: ref });
      return { module, port };
    }
    const rootNets = new Set<string>();
    for (const pin of port.pins) {
      const candidate = pinNet.get(pin);
      if (candidate !== undefined) rootNets.add(candidate);
    }
    if (rootNets.size === 0) {
      addError(diagnostics, "ref.unknown-net", rootAt(path), `interconnect endpoint ${ref} does not resolve to a project net`, { endpoint: ref, net: port.net });
      return { module, port };
    }
    if (rootNets.size > 1) {
      addError(diagnostics, "bind.net-mismatch", rootAt(path), `interconnect endpoint ${ref} has pins on multiple project nets: ${[...rootNets].join(", ")}`, { endpoint: ref, nets: rootNets.size });
    }
    const rootNet = rootNets.values().next().value;
    return rootNet === undefined ? { module, port } : { module, port, rootNet };
  };

  const interconnects = facts.schematic.interconnects ?? [];
  const interconnectById = new Map<string, BindingInterconnect>();
  for (const [index, interconnect] of interconnects.entries()) {
    interconnectById.set(interconnect.id, interconnect);
    const from = endpoint(interconnect.from, `/interconnects/${index}/from`);
    const to = endpoint(interconnect.to, `/interconnects/${index}/to`);
    if (from === undefined || to === undefined) continue;
    if (from.rootNet !== undefined && to.rootNet !== undefined && from.rootNet !== to.rootNet) {
      diagnostics.push({
        code: "bind.net-mismatch",
        severity: "error",
        message: `interconnect ${interconnect.id} joins project net ${from.rootNet} to ${to.rootNet}`,
        location: rootAt(`/interconnects/${index}`),
        hint: "both interconnect endpoints must resolve to the same project net",
        data: { interconnect: interconnect.id, net_a: from.rootNet, net_b: to.rootNet },
        ...(netRows.has(from.rootNet) ? { related: [rootAt(`/nets/${netRows.get(from.rootNet)}`)] } : {}),
      });
    }
    const fromOwners = owners.get(from.module.instance_id) ?? [];
    const toOwners = owners.get(to.module.instance_id) ?? [];
    if (fromOwners.length === 1 && toOwners.length === 1 && fromOwners[0]! === toOwners[0]!) {
      diagnostics.push({
        code: "bind.net-mismatch",
        severity: "error",
        message: `interconnect ${interconnect.id} has both endpoints on PCB ${fromOwners[0]!.pcb.pcb}`,
        location: rootAt(`/interconnects/${index}`),
        hint: "an interconnect is a cross-PCB path; assign its endpoint module instances to different PCBs",
        data: { interconnect: interconnect.id, pcb: fromOwners[0]!.pcb.pcb },
      });
    }
  }

  for (const [index, pinMap] of (facts.schematic.interconnect_pins ?? []).entries()) {
    const interconnect = interconnectById.get(pinMap.interconnect);
    const path = `/interconnect_pins/${index}`;
    if (interconnect === undefined) {
      addError(diagnostics, "ref.unknown-instance", rootAt(`${path}/interconnect`), `interconnect_pins references unknown interconnect ${pinMap.interconnect}`, { interconnect: pinMap.interconnect });
      continue;
    }
    const from = endpoint(interconnect.from, `${path}/from`);
    const to = endpoint(interconnect.to, `${path}/to`);
    const fromModule = moduleOf(pinMap.from);
    const toModule = moduleOf(pinMap.to);
    if (fromModule !== moduleOf(interconnect.from)) {
      addError(diagnostics, "ref.unknown-instance", rootAt(`${path}/from`), `interconnect pin ${pinMap.from} is not on interconnect ${interconnect.id}'s from module`, { interconnect: interconnect.id, pin: pinMap.from });
    }
    if (toModule !== moduleOf(interconnect.to)) {
      addError(diagnostics, "ref.unknown-instance", rootAt(`${path}/to`), `interconnect pin ${pinMap.to} is not on interconnect ${interconnect.id}'s to module`, { interconnect: interconnect.id, pin: pinMap.to });
    }
    if (from !== undefined && !from.port.pins.includes(pinMap.from)) {
      addError(diagnostics, "ref.pin-off-endpoint-net", rootAt(`${path}/from`), `pin ${pinMap.from} is not part of interconnect ${interconnect.id}'s from endpoint port net`, { interconnect: interconnect.id, pin: pinMap.from });
    }
    if (to !== undefined && !to.port.pins.includes(pinMap.to)) {
      addError(diagnostics, "ref.pin-off-endpoint-net", rootAt(`${path}/to`), `pin ${pinMap.to} is not part of interconnect ${interconnect.id}'s to endpoint port net`, { interconnect: interconnect.id, pin: pinMap.to });
    }
  }

  for (const boardFacts of facts.pcbs) checkPcb(facts.schematic, boardFacts, owners, diagnostics);
  return diagnostics;
}
