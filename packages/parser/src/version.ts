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
// The per-type reader fact is its oldest accepted surface. It can be later than the type's birth
// when a breaking language revision rewrites that type's syntax; the ceiling is the current language version.
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
  /** The oldest version of this type that the current reader accepts. */
  required: LanguageVersion;
  /** The newest language version this tool understands — the same ceiling for every type. */
  supported: LanguageVersion;
}

/**
 * The language version this implementation understands (teda.md §13).
 *
 * The language has one version number (ADR-0002): every `.teda` file declares the version of the
 * language it was written against, and it is the same for all description types. It is the `0.x`
 * line the whole language moves on while the surface is still open (ADR-0002 D2): `0.11` is the
 * current global MINOR, and `1.0` is a milestone reached by a decision, not a counter.
 *
 * It is also the upper bound every description type accepts — there is no per-type ceiling.
 */
export const SUPPORTED_LANGUAGE: LanguageVersion = { major: 0, minor: 11, patch: 0 };
/** Coordinate tuples became one cell in language 0.11 (ADR-0065 D5). */
export const TUPLE_VERSION: LanguageVersion = { major: 0, minor: 11, patch: 0 };

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

/** Each description type's oldest surface shape accepted by the current reader. */
const TYPE_READER_FLOOR: Record<DescriptionType, number> = {
  component: 1,
  footprint: 11,
  module: 8,
  pcb: 11,
  procurement: 9,
  schematic: 1,
  symbol: 11,
  system: 2,
  view: 11,
};

/**
 * The versions a description type accepts: from its reader floor up to the language's current
 * version. The upper bound is shared — a `symbol` file at `0.11` is understood (teda.md §13.3,
 * ADR-0002 D4).
 */
export function typeRange(type: DescriptionType): VersionRange {
  return {
    required: { major: SUPPORTED_LANGUAGE.major, minor: TYPE_READER_FLOOR[type], patch: 0 },
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
 * every description type, and the per-type floor is the oldest surface shape this reader accepts.
 * The patch number never decides: any patch of an accepted minor is accepted.
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
    const floor = formatVersion(range.required);
    return {
      ok: false,
      code: "format.unsupported-version",
      message: `this ${typeName} file is older than the format this tool accepts: ${text}; the minimum is ${floor}`,
      hint:
        range.required.minor === TUPLE_VERSION.minor
          ? `write version ${floor} or later; to migrate old coordinate rows, run bun run migrate:0.11 <project dir>`
          : `write version ${floor} or later`,
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
