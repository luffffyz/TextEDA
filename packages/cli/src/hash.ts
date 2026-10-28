// Hashing rules of the IR shard tree (ADR-0105 decision 8, ADR-0105 decision 9).
//
// `node:crypto` appears only in the CLI layer (ADR-0137 decision 1); this module is that layer's
// single hash entry point, so the aggregation rule is written once.
import { createHash } from "node:crypto";

/** SHA-256 of a string, lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 of a byte buffer, lowercase hex. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The aggregation rule of ADR-0105 decision 8: SHA-256 over the `<path>:<sha256>\n` lines of the
 * given entries, sorted by path. It aggregates the project hash over all normative shards and a
 * board hash over that board's normative subset — both governed by ADR-0105 decision 9. The rule
 * is public, so a third party can recompute them.
 */
export function aggregateShardHash(entries: readonly { path: string; sha256: string }[]): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}:${entry.sha256}\n`)
    .join("");
  return sha256Hex(lines);
}
