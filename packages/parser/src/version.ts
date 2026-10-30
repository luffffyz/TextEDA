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
// The language has ONE version number (ADR-0002): every `.teda` file declares the language version it
// was written against, and the number is the same for all description types. The only per-type fact
// left is the version a type was **born** at — a type that did not exist yet cannot have a file from
// before it. The ceiling is the language's current version for every type.
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
  /** The newest language version this tool understands — the same ceiling for every type. */
  supported: LanguageVersion;
}

/**
 * The language version this implementation understands (teda.md §13).
 *
 * The language has one version number (ADR-0002): every `.teda` file declares the version of the
 * language it was written against, and it is the same for all description types. It is the `0.x`
 * line the whole language moves on while the surface is still open (ADR-0002 D2): `0.9` is
 * the last global MINOR, and `1.0` is a milestone reached by a decision, not a counter.
 *
 * It is also the upper bound every description type accepts — there is no per-type ceiling.
 */
export const SUPPORTED_LANGUAGE: LanguageVersion = { major: 0, minor: 9, patch: 1 };

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
 * The language version each description type was born at (`teda.md` §13.3 rule 3).
 *
 * A type that did not exist yet cannot have a file from before it: a `symbol` file claiming `0.4` is
 * nonsense and is refused. The floor is a fact about the type's existence, not about the file's age,
 * so it survives the merge of the version lines (ADR-0002 D4).
 *
 * The upper bound is **not** here: it is the language's current version for every type (ADR-0002 D4).
 */
const TYPE_BIRTH: Record<DescriptionType, number> = {
  component: 1,
  footprint: 4,
  // 0.8 introduces the `module` type.
  module: 8,
  // `pcb` arrived at 0.4, but the flat-board change (0.7) rewrote its shape, so 0.4 files are not
  // read (ADR-0002 D4).
  pcb: 7,
  // 0.9 introduces the `procurement` type.
  procurement: 9,
  // A board file may still be `0.2` (a plain flat board).
  schematic: 1,
  symbol: 5,
  system: 2,
  // `view` arrived at 0.6, and 0.7 rewrote it the same way it rewrote `pcb`.
  view: 7,
};

/**
 * The versions a description type accepts: from the version that introduced the type up to the
 * language's current version. The upper bound is **shared** — a `symbol` file at `0.9` is a file
 * this tool understands, symbols included (teda.md §13.3, ADR-0002 D4).
 */
export function typeRange(type: DescriptionType): VersionRange {
  return {
    required: { major: SUPPORTED_LANGUAGE.major, minor: TYPE_BIRTH[type], patch: 0 },
    supported: { ...SUPPORTED_LANGUAGE },
  };
}

export type VersionVerdict =
  | { ok: true; version: LanguageVersion; text: string }
  | { ok: false; code: DiagnosticCodeId; message: string; hint?: string };

/**
 * Decide whether a file's version line is acceptable for a description type.
 *
 * The language has one version number (ADR-0002): the ceiling is the language's current version for
 * every description type, and the only per-type fact is the version the type was born at — a file
 * from before its type existed is refused.
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
      message: `the ${typeName} type was introduced in version ${formatVersion(range.required)}: ${text} is older`,
      hint: `write version ${formatVersion(range.required)} or later — the ${typeName} type did not exist before that`,
    };
  }
  if (version.minor > range.supported.minor) {
    return {
      ok: false,
      code: "format.unsupported-version",
      message: `the language is at version ${formatVersion(range.supported)}: ${text} is newer`,
      hint: `write ${formatVersion(range.supported)}, or upgrade the tool — the language has one version number for every description type (teda.md §13.3)`,
    };
  }
  return { ok: true, version, text: formatVersion(version) };
}
