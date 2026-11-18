// Rating checks: does a device's declared limit cover the window the design declares for it?
// (ADR-0026.)
//
// The two sides exist in the language and had never been put next to each other: a net states a
// window (`voltage SYS 9V..19.8V`), a device states a limit (a generic's `voltage` column, a
// part's `ratings`). This module compares them at the endpoint that stresses the device, because a
// device that survives only the nominal point is a device with an unexamined failure (D8).
//
// Deliberately narrow (D10 and D12 of ADR-0026): the voltage stress of a device is the difference
// between the potentials of **two named terminals**, read in the **role's direction**. A part's
// rating names the pair (`ratings` rows may carry `from` / `to`, ADR-0026 D4); the role table says
// which polarity stresses the part (D5) and whether the number is a boundary at all (D6). A net
// whose potential is not declared is unknown, and unknown is counted, not passed (D13). The
// opposite polarity of a directed role is neither a violation nor an unknown: it is outside the
// stress the role describes (D12).
//
// Pure: facts in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import { packagePowerRating } from "../devices/packages.ts";
import { DEVICE_ROLES, polesOf, type RoleDirection } from "../devices/rules.ts";
import { amps } from "./current.ts";

/** What the rules need to know about a device (assembled by the caller from the component facts). */
export interface RatingDevice {
  /** The pin numbers of the device, in declaration order. */
  readonly pins: readonly string[];
  /**
   * Each pin's electrical type, by pin number.
   *
   * The poles of a polarised class are the pins typed `polarized`; a pin typed `passive` does not
   * say which way round it is (ADR-0078).
   */
  readonly pin_types?: Readonly<Record<string, string>>;
  /**
   * The pin that carries the positive pole of a polarised class (ADR-0078).
   *
   * Absent for a class written against a language before 0.17: its requirement is then read as a
   * magnitude, the way the language read it before.
   */
  readonly positive_pin?: string;
  /**
   * The device's own ratings (a part only): role → quantity in canonical units, with the two
   * pins the rating is about when it names them (ADR-0026 D4).
   */
  readonly ratings: Readonly<Record<string, RatingFact>>;
  /** The parameter columns a generic declares: role → quantity (the power check reads `value`'s quantity). */
  readonly params?: readonly { readonly name: string; readonly type: string }[];
  /** The generic's construction (a generic only): the technology the package floor is stated for. */
  readonly construction?: string;
  /** The land pattern's package code (JEDEC spelling): what the package floor is keyed by. */
  readonly package_code?: string;
}

/** One rating of a part: what it measures, how much, and the two pins it is about. */
export interface RatingFact {
  readonly type: string;
  readonly value: number | string;
  /** The two pins this rating is about, `from` then `to` (ADR-0026 D4). */
  readonly terminals?: { readonly from: string; readonly to: string };
}

export interface RatingFacts {
  readonly file: string;
  readonly schematic: Schematic;
  /** Devices by component id; a missing id means the component file could not be read. */
  readonly devices: ReadonlyMap<string, RatingDevice>;
  /** Where an instance was written (ADR-0004 D1: the IR carries no line numbers). */
  readonly locateInstance?: (instanceId: string) => DiagnosticLocation | undefined;
}

/**
 * How far one comparison reached: how many instances it compared, and how many it speaks about.
 */
export interface ComparisonCoverage {
  readonly compared: number;
  readonly total: number;
}

/**
 * How far the electrical comparison reached.
 *
 * A device that was not compared is not a device that passed (ADR-0026 D13), so the count of the
 * compared and the count of the uncompared travel with the findings: a report that says "no
 * errors" and leaves this out reads as a pass on a design where most parts were never checked.
 */
export interface RatingCoverage {
  /** The voltage comparison: instances it reached, and the instances the design has. */
  readonly stress: ComparisonCoverage;
  /** The dissipation comparison: resistive instances it reached, and the resistive instances there are. */
  readonly dissipation: ComparisonCoverage;
}

/** What the rating comparison found, and how much of the design it reached. */
export interface RatingReport {
  readonly diagnostics: Diagnostic[];
  readonly coverage: RatingCoverage;
}

/** A voltage window of one net, in microvolts. */
interface Window {
  readonly min_uv: number;
  readonly max_uv: number;
}

/** Why an instance was not compared: the note has to be able to say it. */
type Skip =
  | "no_terminals"
  | "no_capability"
  | "no_window"
  | "conflicting_window"
  | "pin_without_net"
  | "unknown_device";

/** One stress fact: a limit, and the two pins whose potentials it is about. */
interface StressFact {
  /** The role it came from (`voltage`, `drain_source_voltage`, …). */
  readonly role: string;
  /** How the role's polarity reads (ADR-0026 D5). */
  readonly direction: RoleDirection;
  /**
   * What the fact is for.
   *
   * `limit` — the number bounds the stress, and a stress above it is a violation.
   * `polarity` — the number says which way round the pair may be, and a stress above zero means
   * the part is the wrong way round (ADR-0078). Its `limit_uv` is zero: there is no number to
   * exceed, only a direction to keep.
   */
  readonly kind: "limit" | "polarity";
  /** The limit, in microvolts. */
  readonly limit_uv: number;
  /** The `from` pin: the one the role names first. */
  readonly from: string;
  /** The `to` pin: the one the role names second. */
  readonly to: string;
}

/**
 * The stress facts one instance carries: what must not be exceeded, and across which pins.
 *
 * A generic states its requirement in the instances row (`voltage`), and the part it is built from
 * has two pins, so the pair is those two pins. A part states its own ratings, and a rating that
 * names its two terminals says which pins it is about (ADR-0026 D4). A rating without terminals
 * keeps the two-pin inference, and is unknown on a part with more pins (D7): a number whose
 * terminals are not stated cannot be checked against a pair of nets.
 *
 * A polarised class is the third case (ADR-0078): it names its positive pole, so the requirement
 * bounds the voltage in the class's own direction, and the opposite direction is a reversal rather
 * than a magnitude.
 */
function stressFactsOf(
  instance: Schematic["instances"][number],
  device: RatingDevice,
): { facts: StressFact[]; unknown: Skip | null } {
  const facts: StressFact[] = [];
  let unknown: Skip | null = null;

  // A generic's requirement: the instances row's own `voltage` column.
  for (const param of instance.params ?? []) {
    if (param.name !== "voltage") continue;
    if (!("value" in param) || typeof param.value !== "number") continue;
    const poles = polesOf(device);
    if (poles !== null) {
      // The requirement of a polarised class bounds the voltage in the class's own direction: the
      // positive pole above the negative one. The opposite direction is not a magnitude to compare
      // — it is a part mounted the wrong way round.
      facts.push({
        role: "voltage",
        kind: "limit",
        direction: "from",
        limit_uv: param.value,
        from: poles.positive,
        to: poles.negative,
      });
      facts.push({
        role: "voltage",
        kind: "polarity",
        direction: "to",
        limit_uv: 0,
        from: poles.positive,
        to: poles.negative,
      });
      break;
    }
    if (device.pins.length !== 2) {
      unknown ??= "no_terminals";
      break;
    }
    facts.push({
      role: "voltage",
      kind: "limit",
      direction: "symmetric",
      limit_uv: param.value,
      from: device.pins[0]!,
      to: device.pins[1]!,
    });
    break;
  }
  if (facts.length > 0 || unknown !== null) return { facts, unknown };

  // A part's own ratings: the limits a stress check may consume (ADR-0026 D12).
  for (const [role, rating] of Object.entries(device.ratings)) {
    const rule = DEVICE_ROLES[role];
    if (rule === undefined || rule.kind !== "limit" || rule.direction === "none") continue;
    if (rule.type !== "voltage" || typeof rating.value !== "number") continue;
    const terminals = rating.terminals;
    if (terminals !== undefined) {
      facts.push({
        role,
        kind: "limit",
        direction: rule.direction,
        limit_uv: rating.value,
        from: terminals.from,
        to: terminals.to,
      });
      continue;
    }
    // No terminals: the pair can only be inferred for a two-pin part and a role whose polarity
    // does not matter. A directed role needs its pair named, or its polarity is a guess.
    if (rule.direction === "symmetric" && device.pins.length === 2) {
      facts.push({
        role,
        kind: "limit",
        direction: "symmetric",
        limit_uv: rating.value,
        from: device.pins[0]!,
        to: device.pins[1]!,
      });
      continue;
    }
    unknown ??= "no_terminals";
  }
  return { facts, unknown };
}

/**
 * The stress across a pair of nets, in the role's direction (ADR-0026 D5, D8).
 *
 * `null` when the role's polarity never occurs: the design never stresses the part that way, so
 * there is nothing to compare — and that is not "not compared" either (D12).
 */
function stressOf(direction: RoleDirection, from: Window, to: Window): number | null {
  if (direction === "symmetric") {
    return Math.max(Math.abs(from.max_uv - to.min_uv), Math.abs(to.max_uv - from.min_uv));
  }
  const stress = direction === "from" ? from.max_uv - to.min_uv : to.max_uv - from.min_uv;
  return stress >= 0 ? stress : null;
}

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
 * must not read as "checked". The coverage travels with the findings (D13): the caller states it
 * in the report, so a design whose parts were never compared cannot read as a design that passed.
 */
export function checkRatings(facts: RatingFacts): RatingReport {
  const diagnostics: Diagnostic[] = [];
  const { schematic, file } = facts;

  // The potential frame: a net's declared window. The origin is declared by the design
  // (`voltage GND 0V..0V`); the tool does not assume that a net called GND is 0 V (D3).
  //
  // A net that carries two different windows is a design that contradicts itself: the conflict
  // is an error elsewhere (`net.constraint-conflict`), and here the window is unknown rather than
  // whichever of the two happened to come first (D13: unknown is counted, not passed).
  const windows = new Map<string, Window>();
  const conflicting = new Set<string>();
  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "voltage") continue;
    if (!schematic.nets.some((net) => net.id === constraint.subject)) continue;
    const declared = { min_uv: constraint.min_uv, max_uv: constraint.max_uv };
    const known = windows.get(constraint.subject);
    if (known === undefined) {
      windows.set(constraint.subject, declared);
      continue;
    }
    if (known.min_uv !== declared.min_uv || known.max_uv !== declared.max_uv) {
      conflicting.add(constraint.subject);
    }
  }
  for (const subject of conflicting) windows.delete(subject);

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
    const { facts: stressFacts, unknown } = stressFactsOf(instance, device);
    if (stressFacts.length === 0 && unknown === null) {
      skipped.push("no_capability");
      continue;
    }
    // A fact that cannot be resolved leaves the device partly unchecked, so the device counts as
    // not compared: unknown is counted, not passed (D13).
    let reason = unknown;
    for (const fact of stressFacts) {
      const netFrom = netOfPin.get(`${instance.id}.${fact.from}`);
      const netTo = netOfPin.get(`${instance.id}.${fact.to}`);
      if (netFrom === undefined || netTo === undefined) {
        reason ??= "pin_without_net";
        continue;
      }
      const windowFrom = windows.get(netFrom);
      const windowTo = windows.get(netTo);
      if (!windowFrom || !windowTo) {
        reason ??=
          conflicting.has(netFrom) || conflicting.has(netTo) ? "conflicting_window" : "no_window";
        continue;
      }
      // The extreme of the potential difference across the two nets, read in the role's direction.
      const stress = stressOf(fact.direction, windowFrom, windowTo);
      if (stress === null) continue;
      if (fact.kind === "polarity") {
        // The opposite direction of a polarised class's pair: a stress above zero means the part
        // may be the wrong way round (ADR-0078). Zero is not a reversal: the two poles are at the
        // same potential, and nothing is reverse-biased.
        if (stress > 0) {
          diagnostics.push({
            code: "design.polarity-reversed",
            severity: "error",
            message: `${instance.id} (${instance.component}) is mounted the wrong way round: its positive pin ${fact.from} is on ${netFrom} (${volts(windowFrom.min_uv)}..${volts(windowFrom.max_uv)}) and its negative pin ${fact.to} on ${netTo} (${volts(windowTo.min_uv)}..${volts(windowTo.max_uv)}), so the design reverse-biases it by ${volts(stress)}`,
            hint: "swap the two poles, or state why the design may reverse-bias the part",
            location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
            data: {
              instance: instance.id,
              component: instance.component,
              stress_uv: stress,
              net_positive: netFrom,
              net_negative: netTo,
              pin_positive: fact.from,
              pin_negative: fact.to,
            },
          });
        }
        continue;
      }
      if (fact.limit_uv >= stress) continue;
      diagnostics.push({
        code: "design.rating-exceeded",
        severity: "error",
        message: `${instance.id} (${instance.component}) is rated ${volts(fact.limit_uv)} (${fact.role}) but ${netFrom} (${volts(windowFrom.min_uv)}..${volts(windowFrom.max_uv)}) against ${netTo} (${volts(windowTo.min_uv)}..${volts(windowTo.max_uv)}) stresses it to ${volts(stress)}`,
        hint: "use a part with a higher rating, narrow the declared window, or state why the window is what it is",
        location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
        data: {
          instance: instance.id,
          component: instance.component,
          capability_uv: fact.limit_uv,
          stress_uv: stress,
          net_a: netFrom,
          net_b: netTo,
          role: fact.role,
          pin_from: fact.from,
          pin_to: fact.to,
        },
      });
    }
    if (reason !== null) skipped.push(reason);
  }

  if (skipped.length > 0) {
    const counts = {
      no_terminals: skipped.filter((reason) => reason === "no_terminals").length,
      no_capability: skipped.filter((reason) => reason === "no_capability").length,
      no_window: skipped.filter((reason) => reason === "no_window").length,
      conflicting_window: skipped.filter((reason) => reason === "conflicting_window").length,
      pin_without_net: skipped.filter((reason) => reason === "pin_without_net").length,
      unknown_device: skipped.filter((reason) => reason === "unknown_device").length,
    };
    const parts: string[] = [];
    if (counts.no_terminals > 0) parts.push(`${counts.no_terminals} whose rating names no terminals`);
    if (counts.no_capability > 0) parts.push(`${counts.no_capability} with no declared voltage capability`);
    if (counts.no_window > 0) parts.push(`${counts.no_window} on a net without a declared voltage window`);
    if (counts.conflicting_window > 0) parts.push(`${counts.conflicting_window} on a net whose declared windows conflict`);
    if (counts.pin_without_net > 0) parts.push(`${counts.pin_without_net} with a pin in no net`);
    if (counts.unknown_device > 0) parts.push(`${counts.unknown_device} whose device file could not be read`);
    diagnostics.push({
      code: "design.stress-unknown",
      severity: "note",
      message: `${skipped.length} of ${schematic.instances.length} instances were not compared with a declared window: ${parts.join(", ")}`,
      hint: "state the reference potential (voltage GND 0V..0V) and a window on the net; a rating on a part with more than two pins must name its two terminals (ADR-0026 D4)",
      location: { file, line: 1, col: 1 },
      data: { compared: schematic.instances.length - skipped.length, skipped: skipped.length, ...counts },
    });
  }

  const dissipation = checkDissipation(facts, windows, conflicting, netOfPin);
  diagnostics.push(...dissipation.diagnostics);

  return {
    diagnostics,
    coverage: {
      stress: { compared: schematic.instances.length - skipped.length, total: schematic.instances.length },
      dissipation: dissipation.coverage,
    },
  };
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
type PowerSkip =
  | "not_two_terminal"
  | "no_window"
  | "conflicting_window"
  | "pin_without_net"
  | "no_limit"
  | "no_package_rating";

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
 * The current the design states for one instance: the largest requirement on any of its pins.
 *
 * A requirement on a pin is a requirement on the current through the path that pin is on
 * (ADR-0026 D16–D18), so for a two-terminal part it is the current through the part, and it
 * bounds what the part dissipates (ADR-0076 D2). A rail's current is **not** this: it is what the
 * whole net carries, and the language does not say which member of a net carries it
 * (ADR-0026 D18), so it may not become the current of a part.
 */
function statedCurrentOf(
  instance: Schematic["instances"][number],
  schematic: Schematic,
): { max_na: number; subject: string } | null {
  let found: { max_na: number; subject: string } | null = null;
  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "current") continue;
    if (instanceOfPinRef(schematic, constraint.subject) !== instance.id) continue;
    if (found === null || constraint.max_na > found.max_na) {
      found = { max_na: constraint.max_na, subject: constraint.subject };
    }
  }
  return found;
}

/**
 * Worst-case dissipation of a resistive device, against every declared upper bound (ADR-0026).
 *
 * The bound is `ΔV² / R`, with `ΔV` the extreme difference of the declared windows of the two nets —
 * the same worst-case reading ADR-0026 D8/D2 uses for voltage. It is a **bound, not a measurement**:
 * two nets with the same window yield zero even when the part really dissipates, because the current
 * through it is not stated by the language (`current VOUT 3A` does not say who carries it). So this
 * check reports violations and never proves a pass; what it could not compare is counted.
 *
 * A second bound joins it (ADR-0076): when the design states the current through the position, the
 * dissipation is at most `I² × R`, and that is the bound that speaks for a part **in series** — the
 * window span assumes the two windows' extremes co-occur, which for a series element they do not.
 * The tighter of the two binds, so a stated current adds a bound and never removes one.
 */
function checkDissipation(
  facts: RatingFacts,
  windows: ReadonlyMap<string, Window>,
  conflicting: ReadonlySet<string>,
  netOfPin: ReadonlyMap<string, string>,
): { diagnostics: Diagnostic[]; coverage: { compared: number; total: number } } {
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
    const windowsKnown = windowA !== undefined && windowB !== undefined;
    // The current the design states for this position (ADR-0076 D2). It bounds the dissipation on
    // its own, so a position whose nets carry no window is still comparable (D5).
    const stated = statedCurrentOf(instance, schematic);
    if (!windowsKnown && stated === null) {
      skipped.push(
        conflicting.has(netA) || conflicting.has(netB) ? "conflicting_window" : "no_window",
      );
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
      // (ADR-0027), which makes a violation certain rather than a guess about a part.
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
    const span_uw = windowsKnown
      ? Math.round(
          (Math.max(
            Math.abs(windowA.max_uv - windowB.min_uv),
            Math.abs(windowB.max_uv - windowA.min_uv),
          ) **
            2) /
            resistance,
        )
      : null;
    // I in amperes, R in ohms: the quotient is watts, and a watt is a million microwatts.
    const current_uw =
      stated === null
        ? null
        : Math.round((stated.max_na / 1e9) ** 2 * (resistance / 1e6) * 1e6);
    // The tighter of the two bounds binds (ADR-0076 D1): a stated current adds a bound, it never
    // removes the window's ceiling.
    const bound =
      span_uw === null
        ? { uw: current_uw!, basis: "stated_current" as const }
        : current_uw === null
          ? { uw: span_uw, basis: "window_span" as const }
          : current_uw <= span_uw
            ? { uw: current_uw, basis: "stated_current" as const }
            : { uw: span_uw, basis: "window_span" as const };
    if (bound.uw <= binding.max_uw) continue;

    const message =
      bound.basis === "stated_current"
        ? `${instance.id} (${instance.component}) carries at most ${amps(stated!.max_na)} (current ${stated!.subject}), so it can dissipate ${watts(bound.uw)}, but ${binding.what} is ${watts(binding.max_uw)}`
        : `${instance.id} (${instance.component}) can dissipate ${watts(bound.uw)} over its declared windows (${netA} ${volts(windowA!.min_uv)}..${volts(windowA!.max_uv)} against ${netB} ${volts(windowB!.min_uv)}..${volts(windowB!.max_uv)}) but ${binding.what} is ${watts(binding.max_uw)}`;
    diagnostics.push({
      code: "design.rating-exceeded",
      severity: "error",
      message,
      hint: "buy a part with a higher power rating, narrow the declared window on the net, or state why the window is what it is",
      location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
      data: {
        instance: instance.id,
        component: instance.component,
        stress_uw: bound.uw,
        limit_uw: binding.max_uw,
        resistance_uohm: resistance,
        net_a: netA,
        net_b: netB,
        bound: bound.basis,
        ...(stated === null ? {} : { current_na: stated.max_na }),
      },
    });
  }

  if (skipped.length > 0) {
    const counts = {
      not_two_terminal: skipped.filter((reason) => reason === "not_two_terminal").length,
      no_window: skipped.filter((reason) => reason === "no_window").length,
      conflicting_window: skipped.filter((reason) => reason === "conflicting_window").length,
      pin_without_net: skipped.filter((reason) => reason === "pin_without_net").length,
      no_limit: skipped.filter((reason) => reason === "no_limit").length,
      no_package_rating: skipped.filter((reason) => reason === "no_package_rating").length,
    };
    const parts: string[] = [];
    if (counts.not_two_terminal > 0) parts.push(`${counts.not_two_terminal} not two-terminal`);
    if (counts.no_window > 0) parts.push(`${counts.no_window} on a net without a declared voltage window`);
    if (counts.conflicting_window > 0) parts.push(`${counts.conflicting_window} on a net whose declared windows conflict`);
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

  return {
    diagnostics,
    coverage: { compared: resistive - skipped.length, total: resistive },
  };
}

