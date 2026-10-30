// Connectivity ERC (ADR-0038 / backlog F19).
//
// The rules only consume "facts": flattened nets, each instance's pins, which nets carry
// board-level ports.
// No syntax awareness, no filesystem, no parsing intermediate state — so the parser, LSP and
// exporters can share the same rules, and third-party implementations can also compare these
// functions directly against their own parsing results.
//
// Location info is supplied by the caller (`locateNet` / `locateInstance`): the IR is semantics,
// line numbers are source information; precise locations can be reported without stuffing
// them into the IR.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";

/** One net after flattening: id and members (`<instance>.<pin>`). */
export interface ConnectivityNet {
  id: string;
  members: readonly string[];
}

/** One pin of one instance. `type` comes from the component facts; when absent, treated as a regular pin. */
export interface ConnectivityPin {
  /** `<instance>.<pin>`, same shape as net members. */
  key: string;
  component: string;
  name: string;
  type?: string;
}

export interface ConnectivityFacts {
  /** File name of the board, used as a location fallback. */
  file: string;
  nets: readonly ConnectivityNet[];
  /** Nets with board-level ports: their pins go off-board, so a single member is not counted as a missing connection. */
  portNets: ReadonlySet<string>;
  pins: readonly ConnectivityPin[];
  locateNet?: (netId: string) => DiagnosticLocation | undefined;
  locateInstance?: (instanceId: string) => DiagnosticLocation | undefined;
}

function locationOf(
  facts: ConnectivityFacts,
  fallback: DiagnosticLocation | undefined,
): DiagnosticLocation {
  return fallback ?? { file: facts.file, line: 1, col: 1 };
}

/**
 * Run the connectivity rules, return diagnostics (in deterministic order: net-level first,
 * then pin-level).
 *
 * Rules come from `teda.md` §11.4:
 * - A single-member net is a strong signal of a missing connection (nets with ports excepted).
 * - A pin belongs to at most one net.
 * - Every pin, except `no_connect` pins, should land on some net.
 * - A `no_connect` pin that is connected to a net is a contradiction.
 */
export function checkConnectivity(facts: ConnectivityFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const net of facts.nets) {
    if (net.members.length !== 1) continue;
    if (facts.portNets.has(net.id)) continue;
    const first = net.members[0]!;
    diagnostics.push({
      code: "drc.single-member-net",
      severity: "warning",
      message: `net ${net.id} has only one member ${first}`,
      location: locationOf(facts, facts.locateNet?.(net.id)),
      hint: "make sure nothing was omitted; if it really connects only one pin, ignore this warning",
      data: { net: net.id, pin: first },
    });
  }

  const pinOwner = new Map<string, string>();
  for (const net of facts.nets) {
    for (const member of net.members) {
      const owner = pinOwner.get(member);
      if (owner !== undefined) {
        diagnostics.push({
          code: "net.pin-in-two-nets",
          severity: "error",
          message: `pin ${member} belongs to both net ${owner} and ${net.id}`,
          location: locationOf(facts, facts.locateNet?.(net.id)),
          hint: "a pin can belong to only one net; either remove one of the entries, or add a component in between",
          data: { pin: member, net: net.id, other_net: owner },
        });
        continue;
      }
      pinOwner.set(member, net.id);
    }
  }

  const connected = pinOwner;
  for (const pin of facts.pins) {
    const origin = facts.locateInstance?.(pin.key.slice(0, pin.key.lastIndexOf(".")));
    const location = locationOf(facts, origin);
    if (pin.type === "no_connect") {
      if (connected.has(pin.key)) {
        diagnostics.push({
          code: "net.no-connect-connected",
          severity: "error",
          message: `pin ${pin.key} is marked no_connect, yet appears in some net`,
          location,
          hint: "either remove it from the net, or change the pin type in the component file",
          data: { pin: pin.key, net: connected.get(pin.key)! },
        });
      }
      continue;
    }
    if (connected.has(pin.key)) continue;
    diagnostics.push({
      code: "net.pin-unassigned",
      severity: "warning",
      message: `pin ${pin.key} (${pin.name}) is not connected`,
      location,
      hint: "connect it to a net, or mark the pin as no_connect in the component file",
      data: { pin: pin.key, component_id: pin.component },
    });
  }

  return diagnostics;
}
