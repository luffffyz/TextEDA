// Rating checks: does a device's declared limit cover the window the design declares for it?
// (ADR-0043.)
//
// The two sides exist in the language and had never been put next to each other: a net states a
// window (`voltage SYS 9V..19.8V`), a device states a limit (a generic's `voltage` column, a
// part's `ratings`). This module compares them at the endpoint that stresses the device, because a
// device that survives only the nominal point is a device with an unexamined failure (D1).
//
// Deliberately narrow (D6 of ADR-0043): a **two-terminal** device with a `voltage` capability,
// against the difference of its two nets' declared windows. Multi-terminal stress (Vds, Vgs, Vin)
// needs per-construction pin semantics and would otherwise produce noise; a net whose potential
// is not declared is unknown, and unknown is counted, not passed (D4).
//
// Pure: facts in, diagnostics out.
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";

/** What the rules need to know about a device (assembled by the caller from the component facts). */
export interface RatingDevice {
  /** The pin numbers of the device, in declaration order. */
  readonly pins: readonly string[];
  /** The device's own ratings (a part only): role → quantity in canonical units. */
  readonly ratings: Readonly<Record<string, { readonly type: string; readonly value: number | string }>>;
}

export interface RatingFacts {
  readonly file: string;
  readonly schematic: Schematic;
  /** Devices by component id; a missing id means the component file could not be read. */
  readonly devices: ReadonlyMap<string, RatingDevice>;
}

/** A voltage window of one net, in microvolts. */
interface Window {
  readonly min_uv: number;
  readonly max_uv: number;
}

/** Why an instance was not compared: the note has to be able to say it. */
type Skip = "not_two_terminal" | "no_capability" | "no_window" | "pin_without_net" | "unknown_device";

/** `16V`, `4.85V..5.15V` — the canonical unit is microvolts, the surface unit is volts. */
function volts(uv: number): string {
  const value = uv / 1e6;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(4))}V`;
}

/**
 * Compare every comparable instance with the declared window, and report the coverage.
 *
 * One diagnostic per violation; one `note` per board naming how many instances were not compared
 * and why — a board with thirty undecided rails must not bury its real findings, and "no findings"
 * must not read as "checked".
 */
export function checkRatings(facts: RatingFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { schematic, file } = facts;

  // The potential frame: a net's declared window. The origin is declared by the design
  // (`voltage GND 0V..0V`); the tool does not assume that a net called GND is 0 V (D3).
  const windows = new Map<string, Window>();
  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "voltage") continue;
    if (!schematic.nets.some((net) => net.id === constraint.subject)) continue;
    if (!windows.has(constraint.subject)) {
      windows.set(constraint.subject, { min_uv: constraint.min_uv, max_uv: constraint.max_uv });
    }
  }

  // Which net a pin sits on: the net section is the only place that says so.
  const netOfPin = new Map<string, string>();
  for (const net of schematic.nets) {
    for (const member of net.members) {
      if (!netOfPin.has(member)) netOfPin.set(member, net.id);
    }
  }

  const skipped: Skip[] = [];
  for (const instance of [...schematic.instances].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const device = facts.devices.get(instance.component);
    if (!device) {
      skipped.push("unknown_device");
      continue;
    }
    const capability = capabilityOf(instance, device);
    if (capability === null) {
      skipped.push("no_capability");
      continue;
    }
    if (device.pins.length !== 2) {
      skipped.push("not_two_terminal");
      continue;
    }
    const [pinA, pinB] = [device.pins[0]!, device.pins[1]!];
    const netA = netOfPin.get(`${instance.id}.${pinA}`);
    const netB = netOfPin.get(`${instance.id}.${pinB}`);
    if (netA === undefined || netB === undefined) {
      skipped.push("pin_without_net");
      continue;
    }
    const windowA = windows.get(netA);
    const windowB = windows.get(netB);
    if (!windowA || !windowB) {
      skipped.push("no_window");
      continue;
    }
    // The extreme of the potential difference across the two nets.
    const stress = Math.max(
      Math.abs(windowA.max_uv - windowB.min_uv),
      Math.abs(windowB.max_uv - windowA.min_uv),
    );
    if (capability >= stress) continue;
    diagnostics.push({
      code: "design.rating-exceeded",
      severity: "error",
      message: `${instance.id} (${instance.component}) is rated ${volts(capability)} but ${netA} (${volts(windowA.min_uv)}..${volts(windowA.max_uv)}) against ${netB} (${volts(windowB.min_uv)}..${volts(windowB.max_uv)}) stresses it to ${volts(stress)}`,
      hint: "use a part with a higher rating, narrow the declared window, or state why the window is what it is",
      location: { file, line: instance.line ?? 1, col: 1 },
      data: {
        instance: instance.id,
        component: instance.component,
        capability_uv: capability,
        stress_uv: stress,
        net_a: netA,
        net_b: netB,
      },
    });
  }

  if (skipped.length > 0) {
    const counts = {
      not_two_terminal: skipped.filter((reason) => reason === "not_two_terminal").length,
      no_capability: skipped.filter((reason) => reason === "no_capability").length,
      no_window: skipped.filter((reason) => reason === "no_window").length,
      pin_without_net: skipped.filter((reason) => reason === "pin_without_net").length,
      unknown_device: skipped.filter((reason) => reason === "unknown_device").length,
    };
    const parts: string[] = [];
    if (counts.not_two_terminal > 0) parts.push(`${counts.not_two_terminal} not two-terminal`);
    if (counts.no_capability > 0) parts.push(`${counts.no_capability} with no declared voltage capability`);
    if (counts.no_window > 0) parts.push(`${counts.no_window} on a net without a declared voltage window`);
    if (counts.pin_without_net > 0) parts.push(`${counts.pin_without_net} with a pin in no net`);
    if (counts.unknown_device > 0) parts.push(`${counts.unknown_device} whose device file could not be read`);
    diagnostics.push({
      code: "design.stress-unknown",
      severity: "note",
      message: `${skipped.length} of ${schematic.instances.length} instances were not compared with a declared window: ${parts.join(", ")}`,
      hint: "state the reference potential (voltage GND 0V..0V) and a window on the net; multi-pin stress models are not implemented yet",
      location: { file, line: 1, col: 1 },
      data: { compared: schematic.instances.length - skipped.length, skipped: skipped.length, ...counts },
    });
  }

  return diagnostics;
}

/**
 * The voltage capability of one instance, in microvolts.
 *
 * An instance's own `voltage` column comes first: for a generic it is the specification the design
 * needs, and the purchased part has to meet it. A part states the fact in its `ratings` (ADR-0039).
 */
function capabilityOf(
  instance: Schematic["instances"][number],
  device: RatingDevice,
): number | null {
  for (const param of instance.params ?? []) {
    if (param.name !== "voltage") continue;
    if ("value" in param && typeof param.value === "number") return param.value;
  }
  const fromRatings = device.ratings["voltage"];
  if (fromRatings && typeof fromRatings.value === "number") return fromRatings.value;
  return null;
}
