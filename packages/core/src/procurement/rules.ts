// The procurement rules (`spec/procurement.md` §3, ADR-0029).
//
// A selection says which part is bought for a line of the design. Two things can go wrong and
// both matter: the selection can break the rules (it names something that is not a part, it
// changes the land pattern, the part does not meet the line), and the design can outrun the
// procurement (a line nobody sourced).
//
// The comparison of a part against a line is the point of the layer: a line is a requirement,
// not a description, so the part's own ratings are compared with the requirement in each role's
// own direction (`teda.md` §6.2.1). A better part always qualifies — that is what makes a
// second source possible without touching the design.
//
// Pure functions: the facts in, the diagnostics out. No filesystem, no syntax. `texteda check`
// and the BOM builder run the same rules, so a line that passes the check is the line the BOM
// prints.
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { packagePowerRating } from "../devices/packages.ts";

/** Where a fact was written. */
export interface FactLocation {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

/**
 * One line of the design: a generic device with the values the design gave it.
 *
 * The line is the BOM row before procurement: a device id plus the parameter values that
 * distinguish it from another line of the same device. Two 10k resistors with different
 * tolerances are two lines.
 */
export interface DesignLine {
  /** The device id: a generic, or a part the design names directly. */
  readonly component: string;
  /** The values, keyed by role. A number is the canonical integer of the role's quantity. */
  readonly params: Readonly<Record<string, number | string>>;
  /** The instances that use the line; the BOM's quantity is their count. */
  readonly instances: readonly string[];
  readonly location: FactLocation;
}

/** One selection row of a procurement file. */
export interface Selection {
  /** The generic the row buys. */
  readonly generic: string;
  /** The requirement's values, keyed by role. */
  readonly params: Readonly<Record<string, number | string>>;
  /** The selected part, or null for a line that needs no procurement. */
  readonly part: string | null;
  /** Which file the row came from: the primary is normative, the alternatives are advisory. */
  readonly role: "primary" | "alternatives";
  readonly location: FactLocation;
}

/** What the rules need to know about a device. */
export interface Device {
  readonly id: string;
  readonly kind: "part" | "generic";
  /** The manufacturer part number (a part only). */
  readonly mpn?: string;
  /** The land pattern the device uses. */
  readonly footprint: string;
  /** The device's own ratings (a part only): role → quantity. */
  readonly ratings: Readonly<Record<string, { readonly type: string; readonly value: number | string }>>;
  /** The parameter columns a generic declares: role → quantity. */
  readonly params: readonly { readonly name: string; readonly type: string }[];
  /** The generic's construction (ADR-0025): the technology a package floor is stated for. */
  readonly construction?: string;
  /** The land pattern's package code (ADR-0028 decision 1, JEDEC spelling): the floor's other key. */
  readonly package_code?: string;
}

export interface ProcurementFacts {
  /** The board's design lines. */
  readonly lines: readonly DesignLine[];
  /** The selection rows, from both procurement files. */
  readonly selections: readonly Selection[];
  /** The devices, by id. */
  readonly devices: ReadonlyMap<string, Device>;
}

/**
 * How a role is compared (`spec/procurement.md` §3.3).
 *
 * - `envelope`: the part's worst case must lie inside the line's envelope;
 * - `upper`: the part's value must not be worse than the line's (smaller is better);
 * - `lower`: the part's value must not be worse than the line's (bigger is better);
 * - `equal`: the values must be the same class.
 */
type Direction = "envelope" | "upper" | "lower" | "equal";

const DIRECTIONS: Readonly<Record<string, Direction>> = {
  value: "envelope",
  tolerance: "upper",
  voltage: "lower",
  power: "lower",
  dielectric: "equal",
  esr: "upper",
  dcr: "upper",
  rated_current: "lower",
  sat_current: "lower",
};

/** `1W`, `62.5mW`, `840uW` — the canonical unit is microwatts. */
function watts(uw: number): string {
  const trim = (value: number): string => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))));
  if (uw >= 1_000_000) return `${trim(uw / 1_000_000)}W`;
  if (uw >= 1_000) return `${trim(uw / 1_000)}mW`;
  return `${trim(uw)}uW`;
}

/** The role that names a device's primary quantity, whatever its construction. */
const PRIMARY_ROLE = "value";

/** The tolerance is a ratio: the canonical integer is parts per million. */
const PPM = 1_000_000;

/** The line key: the device id plus the values that distinguish it from another line. */
function lineKey(component: string, params: Readonly<Record<string, number | string>>): string {
  const roles = Object.keys(params).sort();
  return JSON.stringify([component, roles.map((role) => [role, params[role]])]);
}

/** The severity of a broken row: the primary is the build, the alternatives are a second source. */
function severityOf(role: "primary" | "alternatives"): "error" | "warning" {
  return role === "primary" ? "error" : "warning";
}

/**
 * Check the selections against the design.
 *
 * The rules (`spec/procurement.md` §3.2 and §3.3):
 * 1. the generic resolves and is a generic — a part may not be re-selected;
 * 2. the part resolves and is a part — a generic may not be selected as a part;
 * 3. the part has a manufacturer part number — that is what makes the row purchasable;
 * 4. the part's ratings cover the roles the line states — otherwise the specification could
 *    not be carried by the part and the BOM line would silently lose a column;
 * 5. the part's footprint equals the generic's — a selection that changes the land pattern is
 *    a design change, not a selection;
 * 6. the part satisfies the line, compared role by role.
 *
 * Plus the two warnings: a line nobody sourced, and a selection for a line the design does not
 * have (a selection may be made for a revision that has not been drawn yet).
 *
 * A generic that does not resolve is left to the parser: it already reports that, with the
 * file and the line.
 */
export function checkProcurement(facts: ProcurementFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lineKeys = new Set(facts.lines.map((line) => lineKey(line.component, line.params)));

  for (const selection of facts.selections) {
    const severity = severityOf(selection.role);
    const at = selection.location;
    const generic = facts.devices.get(selection.generic);
    if (!generic) continue;
    if (generic.kind !== "generic") {
      diagnostics.push({
        code: "value.procurement-generic-invalid",
        severity,
        message: `${selection.generic} is a part, not a generic: a part is bought, not selected`,
        hint: "select a generic device, or drop the row",
        location: { file: at.file, line: at.line, col: at.col },
      });
      continue;
    }

    if (selection.part === null) {
      // `not-required`: the line needs nothing bought. It is not an unsourced line.
      continue;
    }

    const part = facts.devices.get(selection.part);
    if (!part) {
      diagnostics.push({
        code: "ref.unknown-component",
        severity,
        message: `part ${selection.part} not found`,
        hint: `add ${selection.part}.teda under assets/components/`,
        location: { file: at.file, line: at.line, col: at.col },
      });
      continue;
    }
    if (part.kind !== "part") {
      diagnostics.push({
        code: "value.procurement-part-invalid",
        severity,
        message: `${selection.part} is a generic, not a part: a generic is a class of devices, not something to buy`,
        hint: "select a part, or declare the generic itself as a part",
        location: { file: at.file, line: at.line, col: at.col },
      });
      continue;
    }
    if (!part.mpn) {
      diagnostics.push({
        code: "value.procurement-part-mpn-missing",
        severity,
        message: `${selection.part} declares no manufacturer part number`,
        hint: "a part without a part number cannot be bought",
        location: { file: at.file, line: at.line, col: at.col },
      });
    }
    if (part.footprint !== generic.footprint) {
      diagnostics.push({
        code: "bind.procurement-footprint-mismatch",
        severity,
        message: `${selection.part} uses footprint ${part.footprint}, ${selection.generic} uses ${generic.footprint}`,
        expected: generic.footprint,
        actual: part.footprint,
        hint: "a selection that changes the land pattern is a design change",
        location: { file: at.file, line: at.line, col: at.col },
      });
    }

    // Rule 4a (ADR-0027): a chip resistor's package is an implied lower bound. A line that says
    // nothing about power is asking for the standard grade of its package — the lowest a part of
    // that size is sold at — so the selected part must state its rating and meet that floor.
    const floor = packagePowerRating(generic.construction, generic.package_code);
    if (floor !== undefined && selection.params["power"] === undefined) {
      const rated = part.ratings["power"];
      if (rated === undefined) {
        diagnostics.push({
          code: "value.procurement-ratings-missing",
          severity,
          message: `${selection.part} states no power rating, but the ${generic.package_code} package implies at least ${watts(floor)}`,
          expected: "a power rating",
          hint: "a chip resistor's datasheet states its power; state it, or state the line's own power requirement",
          location: { file: at.file, line: at.line, col: at.col },
        });
      } else if (typeof rated.value === "number" && rated.value < floor) {
        diagnostics.push({
          code: "value.procurement-part-unsuitable",
          severity,
          message: `${selection.part} is rated ${watts(rated.value)}, below the ${watts(floor)} the ${generic.package_code} package guarantees`,
          expected: String(floor),
          actual: String(rated.value),
          hint: "buy the standard grade of the package, or state the line's own power requirement",
          data: { role: "power", part: rated.value, line: floor },
          location: { file: at.file, line: at.line, col: at.col },
        });
      }
    }

    // Rule 4: the part's ratings cover the roles the line states.
    const roles = Object.keys(selection.params);
    const missing: string[] = [];
    for (const role of roles) {
      const rating = part.ratings[role];
      if (!rating) {
        missing.push(role);
        continue;
      }
      const wanted = roleType(generic, role);
      if (wanted !== undefined && rating.type !== wanted) {
        diagnostics.push({
          code: "value.procurement-ratings-missing",
          severity,
          message: `${selection.part} states ${role} as ${rating.type}, ${selection.generic} states it as ${wanted}`,
          expected: wanted,
          actual: rating.type,
          hint: "the part has to state the same quantity as the line it is bought for",
          location: { file: at.file, line: at.line, col: at.col },
        });
      }
    }
    if (missing.length > 0) {
      diagnostics.push({
        code: "value.procurement-ratings-missing",
        severity,
        message: `${selection.part} states no rating for ${missing.join(", ")}`,
        expected: `ratings for ${roles.join(", ")}`,
        hint: "a part states its own ratings in its ratings section",
        location: { file: at.file, line: at.line, col: at.col },
      });
    }

    // Rule 6: the part satisfies the line.
    for (const failure of compareWithLine(selection, part)) {
      diagnostics.push({
        code: "value.procurement-part-unsuitable",
        severity,
        message: `${selection.part} does not satisfy the line: ${failure.message}`,
        expected: String(failure.line),
        actual: String(failure.part),
        hint: "select a part that meets the line, or state a weaker line",
        data: { role: failure.role, part: failure.part, line: failure.line },
        location: { file: at.file, line: at.line, col: at.col },
      });
    }
  }

  // A line nobody sourced. The alternatives do not source a line: nothing has been decided
  // there, so only the primary counts.
  const sourced = new Set(
    facts.selections
      .filter((selection) => selection.role === "primary")
      .map((selection) => lineKey(selection.generic, selection.params)),
  );
  for (const line of facts.lines) {
    if (lineKeys.has(lineKey(line.component, line.params)) === false) continue;
    if (sourced.has(lineKey(line.component, line.params))) continue;
    diagnostics.push({
      code: "value.procurement-generic-unsourced",
      severity: "warning",
      message: `${line.component} is used by ${line.instances.join(", ")} but no part is selected for it`,
      hint: "select a part in the primary procurement file, or mark the line not-required",
      location: { file: line.location.file, line: line.location.line, col: line.location.col },
    });
  }

  // A selection for a line the design does not have.
  for (const selection of facts.selections) {
    if (lineKeys.has(lineKey(selection.generic, selection.params))) continue;
    diagnostics.push({
      code: "value.procurement-part-unused",
      severity: "warning",
      message: `${selection.generic} is selected but the design does not use that line`,
      hint: "a selection may be made for a revision that has not been drawn yet",
      location: { file: selection.location.file, line: selection.location.line, col: selection.location.col },
    });
  }

  return diagnostics;
}

/** The quantity a generic declares for a role, when it declares one. */
function roleType(generic: Device, role: string): string | undefined {
  if (role === PRIMARY_ROLE) {
    // The primary quantity is the construction's own (resistance, capacitance, inductance);
    // the generic does not repeat it in its params, so it is read from the value column.
    const value = generic.params.find((param) => param.name === PRIMARY_ROLE);
    return value?.type;
  }
  return generic.params.find((param) => param.name === role)?.type;
}

/** One role of the line the part does not meet. */
interface ComparisonFailure {
  readonly role: string;
  /** What the part states. */
  readonly part: number | string;
  /** What the line asks for. */
  readonly line: number | string;
  /** The message, without the numbers: the numbers are in the payload. */
  readonly message: string;
}

/**
 * Compare the part's own ratings with the line, role by role.
 *
 * Returns the failures, one per role. A role the part does not state is not a failure here —
 * it is already reported as a missing rating.
 */
function compareWithLine(selection: Selection, part: Device): ComparisonFailure[] {
  const failures: ComparisonFailure[] = [];
  for (const [role, required] of Object.entries(selection.params)) {
    const rating = part.ratings[role];
    if (!rating) continue;
    const direction = DIRECTIONS[role];
    if (!direction) continue;
    if (typeof required !== "number" || typeof rating.value !== "number") {
      // A class-valued role (dielectric): the classes must be the same.
      if (direction === "equal" && required !== rating.value) {
        failures.push({
          role,
          part: rating.value,
          line: required,
          message: `the ${role} class is not the one the line asks for`,
        });
      }
      continue;
    }
    switch (direction) {
      case "envelope": {
        // The part's worst case (its nominal ± its own tolerance) must lie inside the line's
        // envelope (the nominal ± the line's tolerance).
        const tolerance = part.ratings["tolerance"];
        const spread =
          tolerance && typeof tolerance.value === "number"
            ? Math.ceil((Math.abs(rating.value) * Math.abs(tolerance.value)) / PPM)
            : 0;
        const low = rating.value - spread;
        const high = rating.value + spread;
        const envelope = toleranceOf(selection, "tolerance");
        const allowed =
          envelope === undefined
            ? 0
            : Math.ceil((Math.abs(required) * Math.abs(envelope)) / PPM);
        if (low < required - allowed || high > required + allowed) {
          failures.push({
            role,
            part: rating.value,
            line: required,
            message: "the part's worst case falls outside the line's envelope",
          });
        }
        break;
      }
      case "upper":
        if (rating.value > required) {
          failures.push({
            role,
            part: rating.value,
            line: required,
            message: `the ${role} is worse than the line allows`,
          });
        }
        break;
      case "lower":
        if (rating.value < required) {
          failures.push({
            role,
            part: rating.value,
            line: required,
            message: `the ${role} is below what the line asks for`,
          });
        }
        break;
      case "equal":
        if (rating.value !== required) {
          failures.push({
            role,
            part: rating.value,
            line: required,
            message: `the ${role} is not the one the line asks for`,
          });
        }
        break;
    }
  }
  return failures;
}

/** The tolerance the line states, in ppm. */
function toleranceOf(selection: Selection, role: string): number | undefined {
  const value = selection.params[role];
  return typeof value === "number" ? value : undefined;
}

/** One BOM row. */
export interface BomLine {
  /** The row key's device id: the generic, or the part the design names directly. */
  readonly component: string;
  /** The row key's parameter values, keyed by role. A part line has none. */
  readonly params: Readonly<Record<string, number | string>>;
  /** The manufacturer part number; empty when nothing is bought for the row. */
  readonly mpn: string;
  /** Whether the row is bought, not sourced yet, or deliberately not bought. */
  readonly status: "bought" | "unsourced" | "not-required";
  /** The selected part (a generic line with a selection). */
  readonly part?: string;
  /** The instances that use the line. */
  readonly instances: readonly string[];
  /** The quantity: how many instances the row covers. */
  readonly quantity: number;
}

/**
 * Build the board's BOM (`spec/procurement.md` §5).
 *
 * Three kinds of row: a part the design names, a generic line with a selection, and a generic
 * line without one. The row key is the device id plus the parameter values, so two lines of the
 * same device with different values are two rows and the quantity counts the instances.
 */
export function buildBomLines(facts: ProcurementFacts): BomLine[] {
  const primary = facts.selections.filter((selection) => selection.role === "primary");
  const lines: BomLine[] = [];

  for (const line of facts.lines) {
    const device = facts.devices.get(line.component);
    if (device?.kind === "part") {
      // The design names the part itself: the row carries that part.
      lines.push({
        component: line.component,
        params: {},
        mpn: device.mpn ?? "",
        status: device.mpn ? "bought" : "unsourced",
        instances: line.instances,
        quantity: line.instances.length,
      });
      continue;
    }
    const selection = primary.find(
      (candidate) =>
        candidate.generic === line.component &&
        lineKey(candidate.generic, candidate.params) === lineKey(line.component, line.params),
    );
    if (!selection) {
      lines.push({
        component: line.component,
        params: line.params,
        mpn: "",
        status: "unsourced",
        instances: line.instances,
        quantity: line.instances.length,
      });
      continue;
    }
    if (selection.part === null) {
      lines.push({
        component: line.component,
        params: line.params,
        mpn: "",
        status: "not-required",
        instances: line.instances,
        quantity: line.instances.length,
      });
      continue;
    }
    const part = facts.devices.get(selection.part);
    lines.push({
      component: line.component,
      params: line.params,
      mpn: part?.mpn ?? "",
      status: part?.mpn ? "bought" : "unsourced",
      ...(part ? { part: part.id } : {}),
      instances: line.instances,
      quantity: line.instances.length,
    });
  }

  // The rows are ordered by their key, so two runs print the same table.
  lines.sort((a, b) => {
    if (a.component !== b.component) return a.component < b.component ? -1 : 1;
    const left = Object.keys(a.params);
    const right = Object.keys(b.params);
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      const role = left[i]!;
      if (role !== right[i]) return role < right[i]! ? -1 : 1;
      const aValue = a.params[role];
      const bValue = b.params[role];
      if (aValue === bValue) continue;
      if (typeof aValue === "number" && typeof bValue === "number") return aValue - bValue;
      return String(aValue) < String(bValue) ? -1 : 1;
    }
    return left.length - right.length;
  });
  return lines;
}
