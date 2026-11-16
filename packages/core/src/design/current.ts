// Current limits against the parts that carry them.
//
// A design states a current limit (`current <pin or net> <max>`); a part states what it is rated
// for (`rated_current` in its `ratings`). Nothing compared them: the limit was parsed, projected
// into the IR and read by nobody, so a connector rated 500 mA sat on a rail the design declared
// 4 A and the conflict was a comment in the component file.
//
// What can be compared, and how certainly, is decided by three things:
//
//   - the **subject**. A limit on a pin says what that pin carries; a limit on a net says what the
//     net carries, and the language does not say which member carries it — a net's members share
//     it (ADR-0026, Open Points).
//   - the **part**. A two-terminal part's rating is about the path between its two pins; a part
//     with more pins has a rating about some path the language does not name (ADR-0026 D4: naming
//     the terminals is not implemented yet).
//   - the **rails around it**. A part that sits on two rails declaring different currents is
//     either a converter between them or a series element, and the language cannot say which —
//     so it is not compared with either.
//
// Only when the subject is a pin and the part is two-terminal is the comparison certain, and only
// then is it an error. Everything else is a warning: the tool names the parts rated below the
// declared current and leaves the attribution to the reader.
//
// What a part is rated for is a fact when the part is a part (its own `ratings`) and a
// requirement when it is a generic (the line's own column, which the procurement layer turns
// into a part the design may buy). Both say the same thing here: the current the part must
// carry.
//
// Pure: facts in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { ComparisonCoverage } from "./ratings.ts";

/** What the rule needs to know about a device. */
export interface CurrentDevice {
  /** The pin numbers of the device, in declaration order. */
  readonly pins: readonly string[];
  /** The device's own ratings (a part only): role → quantity in canonical units. */
  readonly ratings: Readonly<Record<string, { readonly type: string; readonly value: number | string }>>;
  /** The parameter columns a generic declares: role → quantity. */
  readonly params?: readonly { readonly name: string; readonly type: string }[];
}

export interface CurrentFacts {
  readonly file: string;
  readonly schematic: Schematic;
  /** Devices by component id; a missing id means the component file could not be read. */
  readonly devices: ReadonlyMap<string, CurrentDevice>;
  /** Where an instance was written (ADR-0004 D1: the IR carries no line numbers). */
  readonly locateInstance?: (instanceId: string) => DiagnosticLocation | undefined;
}

/** How much of the design the current comparison reached. */
export type CurrentCoverage = ComparisonCoverage;

/** What the comparison found, and how far it reached. */
export interface CurrentReport {
  readonly diagnostics: Diagnostic[];
  readonly coverage: CurrentCoverage;
}

/** The canonical unit is nanoamperes; the surface unit is amperes. */
function amps(na: number): string {
  const value = na / 1e9;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(4))}A`;
}

/**
 * The current a part must carry, in nanoamperes, or `null` when it states none.
 *
 * A part states it as a rating (a datasheet fact); a generic states it as the line's own column
 * (a requirement on the part the design buys).
 */
function ratedCurrentOf(
  instance: Schematic["instances"][number],
  device: CurrentDevice,
): number | null {
  const fromRatings = device.ratings["rated_current"];
  if (fromRatings && fromRatings.type === "current" && typeof fromRatings.value === "number") {
    return fromRatings.value;
  }
  const declaredType = device.params?.find((param) => param.name === "rated_current")?.type;
  const own = (instance.params ?? []).find((param) => param.name === "rated_current");
  if (own && "value" in own && typeof own.value === "number" && declaredType === "current") {
    return own.value;
  }
  return null;
}

/**
 * The instance a pin reference belongs to (`R1.1` → `R1`), or `null` when the subject is a net.
 *
 * A module-qualified instance id contains dots too (`M1.R1.1`), so the split is at the last dot
 * and the prefix must be an instance of this board — a net named `M1.VCC` is a net.
 */
function instanceOfPinRef(schematic: Schematic, subject: string): string | null {
  const dot = subject.lastIndexOf(".");
  if (dot <= 0) return null;
  const owner = subject.slice(0, dot);
  return schematic.instances.some((instance) => instance.id === owner) ? owner : null;
}

/** Why an instance was not compared. */
type NotCompared = "no_rating" | "between_rails";

/**
 * Compare every current limit with what the parts it speaks about are rated for.
 *
 * One diagnostic per part that is rated below the limit; one `note` naming how many parts were
 * not compared at all, and why (ADR-0026 D13: unknown is counted, not passed).
 */
export function checkCurrentRatings(facts: CurrentFacts): CurrentReport {
  const diagnostics: Diagnostic[] = [];
  const { schematic, file } = facts;

  // Which instances each net carries.
  const instancesOfNet = new Map<string, string[]>();
  for (const net of schematic.nets) {
    const instances: string[] = [];
    for (const member of net.members) {
      const instanceId = member.slice(0, member.lastIndexOf("."));
      if (!instances.includes(instanceId)) instances.push(instanceId);
    }
    instancesOfNet.set(net.id, instances);
  }

  // The rails that declare a current, and what they declare.
  const netLimits = new Map<string, number>();
  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "current") continue;
    if (!schematic.nets.some((net) => net.id === constraint.subject)) continue;
    netLimits.set(constraint.subject, constraint.max_na);
  }

  /** The distinct currents the rails around one instance declare. */
  const railsOf = (instanceId: string): number[] => {
    const values = new Set<number>();
    for (const [net, limit] of netLimits) {
      if (instancesOfNet.get(net)?.includes(instanceId)) values.add(limit);
    }
    return [...values];
  };

  /** The instances a limit speaks about. */
  const subjects = new Set<string>();
  /** The instances that could not be compared, and why. */
  const notCompared = new Map<string, NotCompared>();

  const compare = (
    instance: Schematic["instances"][number],
    subject: string,
    declared: number,
    onNet: boolean,
  ): void => {
    const device = facts.devices.get(instance.component);
    const rated = device === undefined ? null : ratedCurrentOf(instance, device);
    if (rated === null) {
      notCompared.set(instance.id, "no_rating");
      return;
    }
    // Certain means both sides are pinned down: the design states the current of that pin, and
    // the part's rating is about the path between its two pins.
    const certain = !onNet && device !== undefined && device.pins.length === 2;
    if (rated < declared) {
      const caveat = onNet
        ? "; the language does not say which member of a net carries its current"
        : (certain ? "" : "; the part's rating does not name the pin it applies to");
      diagnostics.push({
        code: certain ? "design.current-exceeded" : "design.current-below-rating",
        severity: certain ? "error" : "warning",
        message: `${onNet ? `net ${subject} declares ${amps(declared)}` : `pin ${subject} carries at most ${amps(declared)}`}, and ${instance.id} (${instance.component}) is rated ${amps(rated)}${caveat}`,
        hint: "use a part rated for the current this path carries, or state the current of the pin itself (current <pin> <max>), which the tool can compare without guessing",
        location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
        data: {
          instance: instance.id,
          component: instance.component,
          declared_na: declared,
          rated_na: rated,
          ...(onNet ? { net: subject } : { pin: subject }),
        },
      });
    }
  };

  for (const [net, declared] of netLimits) {
    for (const instanceId of instancesOfNet.get(net) ?? []) {
      const instance = schematic.instances.find((item) => item.id === instanceId);
      if (instance === undefined) continue;
      subjects.add(instanceId);
      // A part between two rails that declare different currents carries a current the tool
      // cannot attribute to either one: it is a converter, or a series element, and the language
      // does not say which.
      if (railsOf(instanceId).length > 1) {
        notCompared.set(instanceId, "between_rails");
        continue;
      }
      compare(instance, net, declared, true);
    }
  }

  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "current") continue;
    const owner = instanceOfPinRef(schematic, constraint.subject);
    if (owner === null) continue;
    const instance = schematic.instances.find((item) => item.id === owner);
    if (instance === undefined) continue;
    subjects.add(owner);
    compare(instance, constraint.subject, constraint.max_na, false);
  }

  const compared = [...subjects].filter((instance) => !notCompared.has(instance));
  if (notCompared.size > 0) {
    const withoutRating = [...notCompared.values()].filter((reason) => reason === "no_rating").length;
    const betweenRails = notCompared.size - withoutRating;
    const parts: string[] = [];
    if (withoutRating > 0) parts.push(`${withoutRating} state no rated_current`);
    if (betweenRails > 0) parts.push(`${betweenRails} sit between two rails that declare different currents`);
    diagnostics.push({
      code: "design.current-unknown",
      severity: "note",
      message: `${notCompared.size} of ${subjects.size} instances a current limit speaks about were not compared: ${parts.join(", ")}`,
      hint: "state the part's rated_current (a part's ratings, a generic's line), or state the current of the pin itself",
      location: { file, line: 1, col: 1 },
      data: {
        compared: compared.length,
        skipped: notCompared.size,
        total: subjects.size,
        no_rating: withoutRating,
        between_rails: betweenRails,
      },
    });
  }

  return {
    diagnostics,
    coverage: { compared: compared.length, total: subjects.size },
  };
}
