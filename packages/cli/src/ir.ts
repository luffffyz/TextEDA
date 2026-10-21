// `texteda ir`: write the project's IR shard tree — canonical JSON per description, a manifest
// with one SHA-256 per shard, and the project hash (ADR-0008 decisions 1 and 5, ADR-0023).
//
// Usage:
//   texteda ir <project dir> [--out <dir>] [--json]
//     --out   output directory; defaults to <project dir>/dist/ir
//     --json  machine payload on stdout: diagnostics, manifest, project hash, board hashes
//
// Nothing is written when the project has errors: a half-written tree would carry a project hash
// that does not describe the project.
import { resolve } from "node:path";
import { diagnosticsToPayload, hintFor } from "@texteda/ir/diagnostics";
import { buildIrTree, writeIrTree } from "./ir-tree.ts";

export interface IrOptions {
  /** Project root directory. */
  root: string;
  /** Output directory; defaults to `<root>/dist/ir`. */
  outDir?: string | undefined;
  /** Print the machine payload instead of the human summary. */
  json: boolean;
}

/** Build and write the IR tree. Returns the process exit code: 0 success, 1 errors present. */
export function runIr(options: IrOptions): number {
  const outDir = resolve(options.outDir ?? resolve(options.root, "dist", "ir"));
  const tree = buildIrTree(options.root);

  for (const diagnostic of tree.diagnostics) {
    const where = diagnostic.location
      ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
      : "";
    console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    const hint = diagnostic.hint ?? hintFor(diagnostic.code);
    if (hint) console.error(`    How to fix: ${hint}`);
  }

  const errors = tree.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = tree.diagnostics.filter((d) => d.severity === "warning").length;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          diagnostics: diagnosticsToPayload(tree.diagnostics),
          manifest: tree.manifest,
          project_hash: tree.projectHash,
          board_hashes: Object.fromEntries([...tree.boardHashes].sort()),
          shards: tree.shards.map((shard) => ({
            path: shard.path,
            kind: shard.kind,
            source: shard.source,
            sha256: shard.sha256,
          })),
        },
        null,
        2,
      ),
    );
  }

  if (errors > 0) {
    console.error(`IR not written: ${errors} errors, ${warnings} warnings`);
    return 1;
  }

  writeIrTree(outDir, tree);

  if (!options.json) {
    console.log(`Wrote ${tree.shards.length} shards to ${outDir}`);
    console.log(`Project hash: ${tree.projectHash}`);
    for (const [board, hash] of [...tree.boardHashes].sort()) console.log(`  ${board}: ${hash}`);
  }
  return 0;
}
