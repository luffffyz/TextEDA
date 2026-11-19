// Current requirements against the parts that carry them.
//
// A design states a current requirement on one pin: `current <pin> <max>` (ADR-0026 D18).
// Rail maximum current and its trace-width check belong to PCB rules (ADR-0081).
//
// What a part is rated for is a fact when the part is a part (its own `ratings`) and a
// requirement when it is a generic (the line's own column, which the procurement layer turns
// into a part the design may buy). Both say the same thing here: the current the part must
// carry.
//
// Pure: facts in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";

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

/**
 * How much of the design the current comparison reached.
 *
 * Both counts cover pin-current requirements only; PCB rail-current checks live in current-traces.ts.
 */
export interface CurrentCoverage {
  /** The instances a pin requirement spoke about that were compared with a rating. */
  readonly compared: number;
  /** The instances a pin requirement spoke about. */
  readonly total: number;
}

/** What the comparison found, and how far it reached. */
export interface CurrentReport {
  readonly diagnostics: Diagnostic[];
  readonly coverage: CurrentCoverage;
}

/** The canonical unit is nanoamperes; the surface unit is amperes. */
export function amps(na: number): string {
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

/**
 * Compare every pin requirement with what the part it names is rated for.
 *
 * One diagnostic per part that is rated below the requirement, and one `note` naming how many
 * parts were not compared at all, and why (ADR-0026 D13: unknown is counted, not passed).
 */
export function checkCurrentRatings(facts: CurrentFacts): CurrentReport {
  const diagnostics: Diagnostic[] = [];
  const { schematic, file } = facts;

  /** The pin requirements, in the order the design states them. */
  const requirements: { owner: string; subject: string; max_na: number }[] = [];

  for (const constraint of schematic.constraints ?? []) {
    if (constraint.type !== "current") continue;
    const owner = instanceOfPinRef(schematic, constraint.subject);
    if (owner !== null) requirements.push({ owner, subject: constraint.subject, max_na: constraint.max_na });
  }

  /** The instances a pin requirement speaks about. */
  const subjects = new Set<string>();
  /** The instances that could not be compared, and why. */
  const notCompared = new Set<string>();

  for (const requirement of requirements) {
    const instance = schematic.instances.find((item) => item.id === requirement.owner);
    if (instance === undefined) continue;
    subjects.add(requirement.owner);

    const device = facts.devices.get(instance.component);
    const rated = device === undefined ? null : ratedCurrentOf(instance, device);
    if (rated === null) {
      notCompared.add(requirement.owner);
      continue;
    }
    if (rated >= requirement.max_na) continue;

    // Certain means the rating is about the path the requirement speaks of: a two-terminal part's
    // rating is about the path between its two pins, and the requirement names one of them.
    const certain = device !== undefined && device.pins.length === 2;
    diagnostics.push({
      code: certain ? "design.current-exceeded" : "design.current-below-rating",
      severity: certain ? "error" : "warning",
      message: `pin ${requirement.subject} carries at most ${amps(requirement.max_na)}, and ${instance.id} (${instance.component}) is rated ${amps(rated)}${certain ? "" : "; the part's rating does not name the pin it applies to"}`,
      hint: "use a part rated for the current this pin carries, or state a lower current for it",
      location: facts.locateInstance?.(instance.id) ?? { file, line: 1, col: 1 },
      data: {
        instance: instance.id,
        component: instance.component,
        declared_na: requirement.max_na,
        rated_na: rated,
        pin: requirement.subject,
      },
    });
  }

  if (notCompared.size > 0) {
    const first = [...notCompared][0]!;
    diagnostics.push({
      code: "design.current-unknown",
      severity: "note",
      message: `${notCompared.size} of ${subjects.size} instances a pin current requirement speaks about were not compared: they state no rated_current`,
      hint: "state the part's rated_current (a part's ratings, a generic's line)",
      location: facts.locateInstance?.(first) ?? { file, line: 1, col: 1 },
      data: {
        compared: subjects.size - notCompared.size,
        skipped: notCompared.size,
        total: subjects.size,
        no_rating: notCompared.size,
      },
    });
  }

  return {
    diagnostics,
    coverage: {
      compared: subjects.size - notCompared.size,
      total: subjects.size,
    },
  };
}
