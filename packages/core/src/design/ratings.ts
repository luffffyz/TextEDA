// Rating checks: does a device's declared limit cover the window the design declares for it?
// (ADR-0125.)
//
// The two sides exist in the language and had never been put next to each other: a net states a
// window (`voltage SYS 9V..19.8V`), a device states a limit (a generic's `voltage` column, a
// part's `ratings`). This module compares them at the endpoint that stresses the device, because a
// device that survives only the nominal point is a device with an unexamined failure (D1).
//
// Deliberately narrow (D6 of ADR-0125): a **two-terminal** device with a `voltage` capability,
// against the difference of its two nets' declared windows. Multi-terminal stress (Vds, Vgs, Vin)
// needs per-construction pin semantics and would otherwise produce noise; a net whose potential
// is not declared is unknown, and unknown is counted, not passed (D4).
//
// Pure: facts in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import { packagePowerRating } from "../devices/packages.ts";

/** What the rules need to know about a device (assembled by the caller from the component facts). */
export interface RatingDevice {
  /** The pin numbers of the device, in declaration order. */
  readonly pins: readonly string[];
  /** The device's own ratings (a part only): role → quantity in canonical units. */
  readonly ratings: Readonly<Record<string, { readonly type: string; readonly value: number | string }>>;
  /** The parameter columns a generic declares: role → quantity (the power check reads `value`'s quantity). */
  readonly params?: readonly { readonly name: string; readonly type: string }[];
  /** The generic's construction (a generic only): the technology the package floor is stated for. */
  readonly construction?: string;
  /** The land pattern's package code (JEDEC spelling): what the package floor is keyed by. */
  readonly package_code?: string;
}

export interface RatingFacts {
  readonly file: string;
  readonly schematic: Schematic;
  /** Devices by component id; a missing id means the component file could not be read. */
  readonly devices: ReadonlyMap<string, RatingDevice>;
  /** Where an instance was written (ADR-0103 D1: the IR carries no line numbers). */
  readonly locateInstance?: (instanceId: string) => DiagnosticLocation | undefined;
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
      location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
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

  diagnostics.push(...checkDissipation(facts, windows, netOfPin));

  return diagnostics;
}

/** `2.5W`, `63mW`, `840uW` — the canonical unit is microwatts. */
function watts(uw: number): string {
  if (uw >= 1_000_000) return `${trim(uw / 1_000_000)}W`;
  if (uw >= 1_000) return `${trim(uw / 1_000)}mW`;
  return `${trim(uw)}uW`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** Why a resistive instance was not compared by the power check. */
type PowerSkip = "not_two_terminal" | "no_window" | "pin_without_net" | "no_limit" | "no_package_rating";

/** One upper bound on how much an instance may dissipate. */
interface PowerLimit {
  readonly max_uw: number;
  /** What stated it: the design's own limit, the line's requirement, or the part's rating. */
  readonly what: string;
}

/**
 * The instance a pin reference belongs to (`R1.1` → `R1`), or `null` when the subject is a net.
 *
 * A module-qualified instance id contains dots too (`M1.R1.1`), so the split is at the last dot and
 * the prefix must be an instance of this board — a net named `M1.VCC` is a net.
 */
function instanceOfPinRef(schematic: Schematic, subject: string): string | null {
  const dot = subject.lastIndexOf(".");
  if (dot <= 0) return null;
  const owner = subject.slice(0, dot);
  return schematic.instances.some((instance) => instance.id === owner) ? owner : null;
}

/** The resistance of one instance in microohms: its own `value` column (a generic) or the part's rating. */
function resistanceOf(
  instance: Schematic["instances"][number],
  device: RatingDevice,
): number | null {
  const declaredType = device.params?.find((param) => param.name === "value")?.type;
  const own = (instance.params ?? []).find((param) => param.name === "value");
  if (own && "value" in own && typeof own.value === "number" && declaredType === "resistance") return own.value;
  const rating = device.ratings["value"];
  if (rating && rating.type === "resistance" && typeof rating.value === "number") return rating.value;
  return null;
}

/**
 * Worst-case dissipation of a resistive device, against every declared upper bound (ADR-0125).
 *
 * The bound is `ΔV² / R`, with `ΔV` the extreme difference of the declared windows of the two nets —
 * the same worst-case reading ADR-0125 D8/D2 uses for voltage. It is a **bound, not a measurement**:
 * two nets with the same window yield zero even when the part really dissipates, because the current
 * through it is not stated by the language (`current VOUT 3A` does not say who carries it). So this
 * check reports violations and never proves a pass; what it could not compare is counted.
 */
function checkDissipation(
  facts: RatingFacts,
  windows: ReadonlyMap<string, Window>,
  netOfPin: ReadonlyMap<string, string>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { schematic, file } = facts;

  // A pin subject names the instance that dissipates; a net subject bounds a net, not a part, and is
  // not the power check's business.
  const designLimits = new Map<string, PowerLimit>();
  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "power") continue;
    const owner = instanceOfPinRef(schematic, constraint.subject);
    if (owner === null) continue;
    const seen = designLimits.get(owner);
    if (seen === undefined || constraint.max_uw < seen.max_uw) {
      designLimits.set(owner, { max_uw: constraint.max_uw, what: "the design's dissipation limit" });
    }
  }

  const skipped: PowerSkip[] = [];
  let resistive = 0;
  for (const instance of [...schematic.instances].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const device = facts.devices.get(instance.component);
    if (!device) continue;
    const resistance = resistanceOf(instance, device);
    if (resistance === null || resistance <= 0) continue;
    resistive += 1;
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

    const limits: PowerLimit[] = [];
    const design = designLimits.get(instance.id);
    if (design) limits.push(design);
    const requirement = (instance.params ?? []).find((param) => param.name === "power");
    if (requirement && "value" in requirement && typeof requirement.value === "number") {
      limits.push({ max_uw: requirement.value, what: "the line's power requirement" });
    }
    const rated = device.ratings["power"];
    if (rated && typeof rated.value === "number") {
      limits.push({ max_uw: rated.value, what: `the part's power rating` });
    }
    if (limits.length === 0) {
      // Nothing narrowed the part class, so the package convention is what the design is
      // standing on: the standard rating of this size is the lowest any part of it is sold at
      // (ADR-0126), which makes a violation certain rather than a guess about a part.
      const floor = packagePowerRating(device.construction, device.package_code);
      if (floor === undefined) {
        skipped.push("no_package_rating");
        continue;
      }
      limits.push({
        max_uw: floor,
        what: `the standard rating of a ${device.package_code} chip resistor, the lowest grade that size is sold at`,
      });
    }
    limits.sort((a, b) => (a.max_uw < b.max_uw ? -1 : a.max_uw > b.max_uw ? 1 : 0));
    const binding = limits[0]!;

    // ΔV in microvolts, R in microohms: the quotient is microwatts.
    const stress_uv = Math.max(
      Math.abs(windowA.max_uv - windowB.min_uv),
      Math.abs(windowB.max_uv - windowA.min_uv),
    );
    const stress_uw = Math.round((stress_uv * stress_uv) / resistance);
    if (stress_uw <= binding.max_uw) continue;

    diagnostics.push({
      code: "design.rating-exceeded",
      severity: "error",
      message: `${instance.id} (${instance.component}) can dissipate ${watts(stress_uw)} over its declared windows (${netA} ${volts(windowA.min_uv)}..${volts(windowA.max_uv)} against ${netB} ${volts(windowB.min_uv)}..${volts(windowB.max_uv)}) but ${binding.what} is ${watts(binding.max_uw)}`,
      hint: "buy a part with a higher power rating, narrow the declared window on the net, or state why the window is what it is",
      location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
      data: {
        instance: instance.id,
        component: instance.component,
        stress_uw,
        limit_uw: binding.max_uw,
        resistance_uohm: resistance,
        net_a: netA,
        net_b: netB,
      },
    });
  }

  if (skipped.length > 0) {
    const counts = {
      not_two_terminal: skipped.filter((reason) => reason === "not_two_terminal").length,
      no_window: skipped.filter((reason) => reason === "no_window").length,
      pin_without_net: skipped.filter((reason) => reason === "pin_without_net").length,
      no_limit: skipped.filter((reason) => reason === "no_limit").length,
      no_package_rating: skipped.filter((reason) => reason === "no_package_rating").length,
    };
    const parts: string[] = [];
    if (counts.not_two_terminal > 0) parts.push(`${counts.not_two_terminal} not two-terminal`);
    if (counts.no_window > 0) parts.push(`${counts.no_window} on a net without a declared voltage window`);
    if (counts.pin_without_net > 0) parts.push(`${counts.pin_without_net} with a pin in no net`);
    if (counts.no_limit > 0) parts.push(`${counts.no_limit} with no declared power limit and no package floor`);
    if (counts.no_package_rating > 0)
      parts.push(`${counts.no_package_rating} on a package this tool has no standard rating for`);
    diagnostics.push({
      code: "design.power-unknown",
      severity: "note",
      message: `${skipped.length} of ${resistive} resistive instances were not compared with a power limit: ${parts.join(", ")}`,
      hint: "state the limit the design wants (power R1.1 63mW), the line's power requirement, or the part's power rating",
      location: { file, line: 1, col: 1 },
      data: { resistive, compared: resistive - skipped.length, skipped: skipped.length, ...counts },
    });
  }

  return diagnostics;
}

/**
 * The voltage capability of one instance, in microvolts.
 *
 * An instance's own `voltage` column comes first: for a generic it is the specification the design
 * needs, and the purchased part has to meet it. A part states the fact in its `ratings` (ADR-0125).
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
