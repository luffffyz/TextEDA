// Language version: parsing, comparison and acceptance (teda.md §13).
//
// The version of a `.teda` file is `MAJOR.MINOR[.PATCH]`:
//
//   MAJOR  a breaking change of the accepted language (the meaning of an existing construct changes,
//          a field is removed) — the old files stop being valid.
//   MINOR  an additive change (a new description type, a new section, a new field): the old files
//          stay valid, and a file may use the new construct only from this version on.
//   PATCH  a change that does not change which files are accepted: a new diagnostic, a reworded
//          message, a clarified rule, a stricter check on files that were already invalid.
//
// A PATCH never breaks compatibility, so a tool that implements `MAJOR.MINOR` accepts every patch of
// it, and the patch number is ignored when a file is accepted. The patch component is optional; when
// it is zero it is left out, so `0.6` and `0.6.0` are the same version and the IR stores one spelling.
//
// `1.0` is a milestone, not a number that runs out: it is reached by an explicit decision (the
// language surface is frozen and only patch releases follow), not as a side effect of counting.
import type { DiagnosticCodeId } from "./diagnostics.ts";

export interface LanguageVersion {
  major: number;
  minor: number;
  patch: number;
}

/** `MAJOR.MINOR` with an optional `.PATCH`; no leading zeros. */
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/;

/** Parse a version string; `null` when it is not a version. */
export function parseVersion(text: string): LanguageVersion | null {
  const m = VERSION_RE.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] === undefined ? 0 : Number(m[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
  return { major, minor, patch };
}

/** Compare two versions: negative when `a` is older, 0 when equal, positive when `a` is newer. */
export function compareVersions(a: LanguageVersion, b: LanguageVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** The canonical spelling: the patch component is left out when it is zero. */
export function formatVersion(version: LanguageVersion): string {
  return version.patch === 0 ? `${version.major}.${version.minor}` : `${version.major}.${version.minor}.${version.patch}`;
}

/** The versions a description type accepts. */
export interface VersionRange {
  /** The version that introduced the type: a file below it cannot use the type at all. */
  required: LanguageVersion;
  /** The newest language version this tool understands. */
  supported: LanguageVersion;
}

/**
 * The newest language version this implementation understands (teda.md §13).
 *
 * It is the `0.x` line the whole language moves on while the surface is still open (ADR-0022's
 * appendix): `0.9` is the last global number, and `1.0` is a milestone reached by a decision, not a
 * counter. It is **not** the upper bound of a description type — that is the type's own line below.
 */
export const SUPPORTED_LANGUAGE: LanguageVersion = { major: 0, minor: 9, patch: 0 };

/** Every description type this implementation reads. */
export type DescriptionType =
  | "component"
  | "footprint"
  | "module"
  | "pcb"
  | "procurement"
  | "schematic"
  | "symbol"
  | "system"
  | "view";

/**
 * One type's version line (`teda.md` §13.3 rule 4).
 *
 * `born` is the version that introduced the type (or changed its surface so much that an older file
 * cannot be read): a file below it is rejected. `current` is the newest surface of that type: a file
 * above it is rejected, because no construct of that type means anything there yet.
 *
 * While the language is `0.x`, a type only moves by PATCH (ADR-0022 appendix), so `current` equals
 * the surface the type last gained — the numbers differ per type on purpose: a `symbol` file says
 * `0.5`, a `view` file `0.7`, a `procurement` file `0.9`, and all three are current.
 */
const TYPE_LINES: Record<DescriptionType, { born: number; current: number }> = {
  component: { born: 1, current: 1 },
  footprint: { born: 4, current: 4 },
  // 0.9 adds the stable instance UID column (ADR-0051).
  module: { born: 8, current: 9 },
  pcb: { born: 7, current: 7 },
  procurement: { born: 9, current: 9 },
  // A board file may still be `0.2` (a plain flat board); `0.8` added the `modules` section;
  // `0.9` adds the optional UID column (ADR-0051).
  schematic: { born: 1, current: 9 },
  symbol: { born: 5, current: 5 },
  system: { born: 2, current: 2 },
  view: { born: 7, current: 7 },
};

/**
 * The versions a description type accepts: from the version that introduced the type up to that
 * type's own current version. The upper bound is **not** shared: a type that has not changed since
 * `0.5` rejects a `0.9` file, because nothing in it is newer (teda.md §13.3).
 */
export function typeRange(type: DescriptionType): VersionRange {
  const line = TYPE_LINES[type];
  return {
    required: { major: SUPPORTED_LANGUAGE.major, minor: line.born, patch: 0 },
    supported: { major: SUPPORTED_LANGUAGE.major, minor: line.current, patch: 0 },
  };
}

export type VersionVerdict =
  | { ok: true; version: LanguageVersion; text: string }
  | { ok: false; code: DiagnosticCodeId; message: string; hint?: string };

/**
 * Decide whether a file's version line is acceptable for a description type.
 *
 * The patch number never decides: a patch release does not change the accepted file set, so any patch
 * of an accepted minor is accepted.
 */
export function checkVersion(text: string, range: VersionRange, typeName: string): VersionVerdict {
  const version = parseVersion(text);
  if (!version) {
    return { ok: false, code: "format.invalid-version", message: `not a valid version number: ${text}` };
  }
  if (version.major !== range.supported.major) {
    return {
      ok: false,
      code: "format.unsupported-version",
      message: `this file is ${text}, this tool supports the ${range.supported.major}.x line`,
      hint: "lower the file version, or upgrade the tool",
    };
  }
  if (version.minor < range.required.minor) {
    return {
      ok: false,
      code: "format.unsupported-version",
      message: `the ${typeName} type requires version ${formatVersion(range.required)} (current: ${text})`,
    };
  }
  if (version.minor > range.supported.minor) {
    return {
      ok: false,
      code: "format.unsupported-version",
      message: `the ${typeName} type is at version ${formatVersion(range.supported)}: ${text} is newer`,
      hint: `write ${formatVersion(range.supported)}, or upgrade the tool — each description type has its own version line (teda.md §13.3)`,
    };
  }
  return { ok: true, version, text: formatVersion(version) };
}
