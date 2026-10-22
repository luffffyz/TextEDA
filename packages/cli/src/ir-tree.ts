// The IR shard tree: compile every description that has a producer today, write the shards as
// canonical JSON, hash them, and write the manifest (ADR-0008 decisions 1 and 5, ADR-0023).
//
// The file system and `node:crypto` appear only here, in the CLI layer (ADR-0009 decision 1):
// `packages/ir` / `packages/parser` / `packages/core` never touch the disk.
//
// Shard layout (one source file -> one shard, ADR-0008 decision 1):
//
//   dist/ir/
//   ├── manifest.json                  # shard paths + sha256 per shard + the project hash
//   ├── boards/<board_id>/schematic.json
//   ├── boards/<board_id>/pcb.json
//   ├── boards/<board_id>/view/<page_id>.json
//   ├── symbols/<lib>/<symbol_id>.json
//   └── footprints/<lib>/<footprint_id>.json
//
// `components/`, `project.json` and `systems/` have no producer yet (no component IR parser, no
// `project.toml` parser, no `system` parser), so they are absent until those land.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { schemaDiagnosticsToDiagnostics, validate, type SchemaKind } from "@texteda/ir";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import {
  canonicalJson,
  parseFootprint,
  parsePcb,
  parseSchematic,
  parseSymbol,
  parseView,
} from "@texteda/parser";
import { listBoards, loadBoard, loadComponents, loadModules, loadPcb } from "./project.ts";

/** One compiled shard: canonical bytes plus the hash of those bytes. */
export interface IrShard {
  /** Shard path relative to the IR root, e.g. `boards/charger-buck/schematic.json`. */
  path: string;
  /** The contract the shard is validated against. */
  kind: SchemaKind;
  /** Source file the shard was compiled from, relative to the project root. */
  source: string;
  /** Canonical JSON bytes of the shard (exactly what is written to disk). */
  bytes: string;
  /** SHA-256 of `bytes`, lowercase hex. */
  sha256: string;
}

/** The manifest document (`schemas/ir/v0.2/manifest.schema.json`). */
export interface IrManifest {
  ir_version: string;
  tool_version: string;
  shards: { path: string; sha256: string }[];
  source_hash: string;
}

export interface IrTree {
  /** All shards, sorted by path. */
  shards: IrShard[];
  /** The manifest to write as `manifest.json`. */
  manifest: IrManifest;
  /** Project hash: the aggregation over all shards (ADR-0008 decision 5). */
  projectHash: string;
  /** Board hash per board id: the same aggregation over that board's shards. */
  boardHashes: Map<string, string>;
  /** Parse and contract diagnostics of every compiled description. */
  diagnostics: Diagnostic[];
}

/** SHA-256 of a string, lowercase hex. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The aggregation rule of ADR-0008 decision 5: SHA-256 over the `<path>:<sha256>\n` lines of the
 * given shards, sorted by path. The project hash uses all shards, a board hash the subset of one
 * board. The rule is public, so a third party can recompute both from the manifest.
 */
export function aggregateShardHash(entries: readonly { path: string; sha256: string }[]): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}:${entry.sha256}\n`)
    .join("");
  return sha256Hex(lines);
}

/** The tool's own version, taken from the repository's root `package.json`; `0.0.0` when it is unreadable. */
export function toolVersion(): string {
  try {
    const text = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(text) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** The IR contract version of the schemas in this repository. */
const IR_VERSION = "0.2";

interface Draft {
  path: string;
  kind: SchemaKind;
  source: string;
  ir: unknown;
}

/** Compile every description of the project that has a producer today. */
export function buildIrTree(root: string): IrTree {
  const drafts: Draft[] = [];
  const diagnostics: Diagnostic[] = [];
  const { resolver } = loadComponents(root);
  const modules = loadModules(root);

  for (const board of listBoards(root)) {
    const loaded = loadBoard(root, board);
    if (!loaded) continue;
    const schematic = parseSchematic(loaded.text, {
      file: loaded.file,
      board,
      components: resolver,
      modules,
    });
    diagnostics.push(...schematic.diagnostics);
    if (schematic.ir) {
      drafts.push({
        path: `boards/${board}/schematic.json`,
        kind: "schematic",
        source: loaded.file,
        ir: schematic.ir,
      });
    }

    const pcb = loadPcb(root, board);
    if (pcb) {
      const parsed = parsePcb(pcb.text, { file: pcb.file, board });
      diagnostics.push(...parsed.diagnostics);
      if (parsed.ir) {
        drafts.push({
          path: `boards/${board}/pcb.json`,
          kind: "pcb",
          source: pcb.file,
          ir: parsed.ir,
        });
      }
    }

    // A print page's drawing is a separate description (ADR-0021); it is not part of the schematic shard.
    for (const view of loaded.views) {
      const parsed = parseView(view.text, {
        file: view.file,
        board,
      });
      diagnostics.push(...parsed.diagnostics);
      if (parsed.ir) {
        drafts.push({
          path: `boards/${board}/view/${view.pageId}.json`,
          kind: "schematic-view",
          source: view.file,
          ir: parsed.ir,
        });
      }
    }
  }

  const libraries: {
    kind: SchemaKind;
    dir: string;
    parse: (text: string, options: { file: string; library: string }) => {
      ir?: unknown;
      diagnostics: Diagnostic[];
    };
  }[] = [
    { kind: "symbol", dir: "symbols", parse: parseSymbol },
    { kind: "footprint", dir: "footprints", parse: parseFootprint },
  ];
  for (const { kind, dir, parse } of libraries) {
    for (const file of libraryFiles(root, dir)) {
      const library = file.library;
      const parsed = parse(readFileSync(file.path, "utf8"), {
        file: file.source,
        library,
      });
      diagnostics.push(...parsed.diagnostics);
      if (!parsed.ir) continue;
      drafts.push({
        path: `${dir}/${library}/${file.id}.json`,
        kind,
        source: file.source,
        ir: parsed.ir,
      });
    }
  }

  const shards: IrShard[] = [];
  for (const draft of drafts) {
    const check = validate(draft.kind, draft.ir);
    if (!check.ok) {
      diagnostics.push(...schemaDiagnosticsToDiagnostics(check.errors));
      continue;
    }
    const bytes = canonicalJson(draft.ir);
    shards.push({
      path: draft.path,
      kind: draft.kind,
      source: draft.source,
      bytes,
      sha256: sha256Hex(bytes),
    });
  }
  shards.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const entries = shards.map((shard) => ({ path: shard.path, sha256: shard.sha256 }));
  const projectHash = aggregateShardHash(entries);
  const boardHashes = new Map<string, string>();
  for (const board of listBoards(root)) {
    const prefix = `boards/${board}/`;
    const subset = entries.filter((entry) => entry.path.startsWith(prefix));
    if (subset.length > 0) boardHashes.set(board, aggregateShardHash(subset));
  }

  const manifest: IrManifest = {
    ir_version: IR_VERSION,
    tool_version: toolVersion(),
    shards: entries,
    source_hash: projectHash,
  };

  // The manifest is itself a shard of the contract; check it before anything is written. An empty
  // manifest cannot satisfy the contract (it lists at least one shard), so an empty project is
  // reported as such instead of as a contract violation.
  if (shards.length === 0) {
    diagnostics.push({
      code: "cli.empty-project",
      severity: "error",
      message: `No description with a producer was found in ${root}`,
      hint: "Add a board description (sch/<board_id>.teda), a PCB description, or a library file; or point at the right project directory",
    });
  } else {
    const manifestCheck = validate("manifest", manifest);
    if (!manifestCheck.ok) diagnostics.push(...schemaDiagnosticsToDiagnostics(manifestCheck.errors));
  }

  return { shards, manifest, projectHash, boardHashes, diagnostics };
}

/**
 * Write the tree: one canonical JSON file per shard, plus `manifest.json`.
 *
 * Files under the output directory that the tree does not own are removed, so a deleted source
 * file does not leave a stale shard behind (a stale shard would change the project hash).
 */
export function writeIrTree(outDir: string, tree: IrTree): void {
  mkdirSync(outDir, { recursive: true });
  const owned = new Set<string>(["manifest.json"]);
  for (const shard of tree.shards) {
    const target = join(outDir, shard.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, shard.bytes);
    owned.add(shard.path);
  }
  writeFileSync(join(outDir, "manifest.json"), canonicalJson(tree.manifest));
  for (const file of filesUnder(outDir)) {
    if (owned.has(file)) continue;
    rmSync(join(outDir, file), { force: true });
  }
  removeEmptyDirs(outDir);
}

/** Every file under a directory, as a path relative to it. */
function filesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** Remove the directories that became empty after pruning stale shards. */
function removeEmptyDirs(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    removeEmptyDirs(child);
    if (readdirSync(child).length === 0) rmSync(child, { recursive: true, force: true });
  }
}

interface LibraryFile {
  /** Absolute path of the source file. */
  path: string;
  /** Path relative to the project root (the IR's `source.file`). */
  source: string;
  /** File name without the `.teda` suffix. */
  id: string;
  /** Library name: the directory the file lives in, relative to the library root. */
  library: string;
}

/** All `.teda` files of a library directory (`symbols/`, `footprints/`). */
function libraryFiles(root: string, dir: string): LibraryFile[] {
  const base = join(root, dir);
  const out: LibraryFile[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".teda")) {
        const source = relative(root, full);
        // The library is the directory under the library root (`symbols/<lib>/<id>.teda`); a file
        // that sits directly in the library root has no library of its own and falls back to the
        // root directory's name.
        const segments = relative(base, path).split(/[\\/]/).filter((part) => part !== "");
        out.push({
          path: full,
          source,
          id: entry.name.slice(0, entry.name.length - ".teda".length),
          library: segments.length > 0 ? segments[0]! : basename(base),
        });
      }
    }
  };
  if (!existsSync(base)) return out;
  walk(base);
  return out;
}
