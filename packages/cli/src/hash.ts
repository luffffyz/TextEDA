// Hashing rules shared by the shard tree and the library verification (ADR-0008 decision 5,
// ADR-0023 decision 4, ADR-0046 decision 1).
//
// `node:crypto` appears only in the CLI layer (ADR-0009 decision 1); this module is that layer's
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
 * The aggregation rule of ADR-0008 decision 5: SHA-256 over the `<path>:<sha256>\n` lines of the
 * given entries, sorted by path. The project hash uses all normative shards, a board hash the
 * subset of one board, and a library hash the files of one vendored subtree (ADR-0046 decision 1).
 * The rule is public, so a third party can recompute all of them.
 */
export function aggregateShardHash(entries: readonly { path: string; sha256: string }[]): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}:${entry.sha256}\n`)
    .join("");
  return sha256Hex(lines);
}
