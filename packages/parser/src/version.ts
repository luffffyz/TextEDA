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
 * This is the upper bound of every description type: a file may declare any version up to it, and
 * the version a type was introduced in is only its lower bound. When the language reaches `1.0`
 * (a milestone, not a counter — see ADR-0022) this constant moves to the `1.x` line.
 */
export const SUPPORTED_LANGUAGE: LanguageVersion = { major: 0, minor: 9, patch: 0 };

/**
 * The versions a description type accepts: from the version that introduced the type up to the
 * language version this tool supports.
 */
export function typeRange(introducedMinor: number): VersionRange {
  return {
    required: { major: SUPPORTED_LANGUAGE.major, minor: introducedMinor, patch: 0 },
    supported: SUPPORTED_LANGUAGE,
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
      message: `version ${text} is newer than the ${formatVersion(range.supported)} supported by this tool`,
      hint: "lower the file version, or upgrade the tool",
    };
  }
  return { ok: true, version, text: formatVersion(version) };
}
