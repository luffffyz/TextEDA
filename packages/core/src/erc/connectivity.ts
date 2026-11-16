// Connectivity ERC (ADR-0038 / backlog F19).
//
// The rules only consume "facts": flattened nets, each instance's pins, which nets carry
// board-level ports, and which nets may be driven from outside the design.
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
  /**
   * Nets whose source may live outside this design — a net a module port is bound to. A module
   * port says "the board may connect something here", so the driver can be another module or the
   * board itself; a missing driver on such a net proves nothing.
   */
  externallyDrivenNets?: ReadonlySet<string>;
  pins: readonly ConnectivityPin[];
  locateNet?: (netId: string) => DiagnosticLocation | undefined;
  locateInstance?: (instanceId: string) => DiagnosticLocation | undefined;
}

/** Pin types that expect a signal to arrive: one that is not connected floats. */
const SIGNAL_INPUTS = new Set(["input", "power_in"]);

/** Pin types that can source current into a net. */
const SOURCES = new Set(["power_out", "output", "bidirectional", "tri_state"]);

/**
 * Pin types that drive a net hard: two of them on one net fight each other, so the net has no
 * defined level. `open_collector` and `open_emitter` are left out on purpose — several of them
 * sharing one net is how a wired-AND bus works.
 */
const HARD_SOURCES = new Set(["power_out", "output"]);

function locationOf(
  facts: ConnectivityFacts,
  fallback: DiagnosticLocation | undefined,
): DiagnosticLocation {
  return fallback ?? { file: facts.file, line: 1, col: 1 };
}

/** The instance id a flattened pin key belongs to: `M1.U1.7` → `M1.U1`. */
function instanceOf(key: string): string {
  return key.slice(0, key.lastIndexOf("."));
}

/**
 * Run the connectivity rules, return diagnostics (in deterministic order: net-level first,
 * then pin-level).
 *
 * Rules come from `spec/teda.md` §7.2 and §11, rule 4:
 * - A single-member net is a strong signal of a missing connection (nets with ports excepted).
 * - A pin belongs to at most one net.
 * - Every pin, except `no_connect` pins, should land on some net.
 * - A `no_connect` pin that is connected to a net is a contradiction.
 *
 * The electrical types of the pins carry the rest (spec/teda.md §9.1):
 * - Two hard drivers on one net fight each other.
 * - A pin that expects a signal and gets none is a floating input, not a spare pin.
 * - A power input on a net that nothing sources is pointed at — the source may sit behind a
 *   series element or off-board, so the tool reports it instead of judging it.
 */
export function checkConnectivity(facts: ConnectivityFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // What each pin is, by key: the type decides which rules can judge it.
  const pinByKey = new Map<string, ConnectivityPin>();
  for (const pin of facts.pins) pinByKey.set(pin.key, pin);
  const typeOf = (member: string): string | undefined => pinByKey.get(member)?.type;

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

  // Two hard drivers on one net: the net has no defined level. A conflict is a contradiction in
  // the facts, so it is an error — not an emergent warning.
  for (const net of facts.nets) {
    const drivers = net.members.filter((member) => {
      const type = typeOf(member);
      return type !== undefined && HARD_SOURCES.has(type);
    });
    if (drivers.length < 2) continue;
    diagnostics.push({
      code: "net.output-conflict",
      severity: "error",
      message: `net ${net.id} is driven by ${drivers.join(" and ")}`,
      location: locationOf(facts, facts.locateNet?.(net.id)),
      hint: "a net has one driver; remove one of them, or change the pin type in the component file if that part does not drive the net",
      data: { net: net.id, drivers: drivers.join(" ") },
    });
  }

  // A power input needs a source on its net. Nets that may be driven from outside the design
  // (a root port, a module port) are exempt: the source can be off-board.
  for (const net of facts.nets) {
    if (facts.portNets.has(net.id)) continue;
    if (facts.externallyDrivenNets?.has(net.id)) continue;
    let sourced = false;
    const needing: string[] = [];
    for (const member of net.members) {
      const type = typeOf(member);
      if (type === undefined) continue;
      if (SOURCES.has(type)) {
        sourced = true;
        break;
      }
      if (type === "power_in") needing.push(member);
    }
    if (sourced || needing.length === 0) continue;
    for (const member of needing) {
      const pin = pinByKey.get(member);
      diagnostics.push({
        code: "net.power-undriven",
        severity: "note",
        message: `pin ${member} (${pin?.name ?? "?"}) is a power input on net ${net.id}, and no pin on that net sources it`,
        location: locationOf(facts, facts.locateInstance?.(instanceOf(member))),
        hint: "the source may sit on another net behind a series element, or off-board — the tool sees this net only, so read it by hand",
        data: { pin: member, net: net.id },
      });
    }
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
    const origin = facts.locateInstance?.(instanceOf(pin.key));
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
    // A pin that expects a signal and has none is a different finding from a spare passive: the
    // first is a floating input, the second is usually a pin reserved for later.
    if (pin.type !== undefined && SIGNAL_INPUTS.has(pin.type)) {
      diagnostics.push({
        code: "net.input-unassigned",
        severity: "warning",
        message: `pin ${pin.key} (${pin.name}) is an input and is not connected`,
        location,
        hint: "connect it to a net, or mark the pin no_connect in the component file if it is intentionally left open",
        data: { pin: pin.key, component_id: pin.component, pin_type: pin.type },
      });
      continue;
    }
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
