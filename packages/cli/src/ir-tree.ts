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
//   ├── footprints/<lib>/<footprint_id>.json
//   ├── components/<component_id>.json
//   ├── project.json                   # the project file's metadata
//   └── systems/<system_id>.json
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { irVersion, schemaDiagnosticsToDiagnostics, validate, type SchemaKind, type SourceMap } from "@texteda/ir";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { aggregateShardHash, sha256Hex } from "./hash.ts";
import { buildIdentityDocument, type IdentityDocument } from "./identity.ts";
import {
  canonicalJson,
  parseFootprint,
  parsePcb,
  parseProcurement,
  parseProjectToml,
  parseSchematic,
  parseSymbol,
  parseSystem,
  parseView,
} from "@texteda/parser";
import { PROCUREMENT_ROLES } from "@texteda/parser";
import { LAYOUT } from "./paths.ts";
import { locateWith } from "./locate.ts";
import { checkProjectInstanceUids, type ProjectUidInput } from "./uids.ts";
import {
  listBoards,
  listProcurement,
  listSystems,
  loadBoard,
  loadComponents,
  loadModules,
  loadPcb,
  loadProcurement,
  loadProject,
} from "./project.ts";

/** One compiled shard: canonical bytes plus the hash of those bytes. */
export interface IrShard {
  /** Shard path relative to the IR root, e.g. `boards/charger-buck/schematic.json`. */
  path: string;
  /** The contract the shard is validated against. */
  kind: SchemaKind;
  /** Source file the shard was compiled from, relative to the project root. */
  source: string;
  /**
   * Whether the build depends on this shard (ADR-0023 decision 4, amended 2026-10-22).
   *
   * A normative shard is part of the build identity; an advisory one is not: nothing that is
   * built depends on it, so changing it does not invalidate a signed manufacturing package. The
   * classification is a property of the source file, and the manifest records it, so a tool never
   * has to infer it from a path.
   */
  normative: boolean;
  /** Canonical JSON bytes of the shard (exactly what is written to disk). */
  bytes: string;
  /** SHA-256 of `bytes`, lowercase hex. */
  sha256: string;
}

/** The manifest document (`schemas/ir/v0.5/manifest.schema.json`). */
export interface IrManifest {
  ir_version: string;
  tool_version: string;
  shards: { path: string; sha256: string; normative: boolean }[];
  /** Project hash: the aggregation over the normative shards. */
  source_hash: string;
  /** Advisory hash: the aggregation over the advisory shards. Absent when there are none. */
  advisory_hash?: string | undefined;
}

export interface IrTree {
  /** All shards, sorted by path. */
  shards: IrShard[];
  /** The manifest to write as `manifest.json`. */
  manifest: IrManifest;
  /** Project hash: the aggregation over the normative shards (ADR-0008 decision 5, ADR-0023). */
  projectHash: string;
  /** Advisory hash: the same aggregation over the advisory shards. Absent when there are none. */
  advisoryHash?: string | undefined;
  /** Board hash per board id: the same aggregation over that board's normative shards. */
  boardHashes: Map<string, string>;
  /** Parse and contract diagnostics of every compiled description. */
  diagnostics: Diagnostic[];
  /**
   * Advisory identity index (ADR-0020 D6): identity → source locations. It is written beside the
   * shards as `identity.json`, but it is not a shard and never enters a hash.
   */
  identity: IdentityDocument;
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

/** The IR contract version of the schemas in this repository (one source: the generated schemas). */
const IR_VERSION = irVersion;

interface Draft {
  path: string;
  kind: SchemaKind;
  source: string;
  /** Whether the build depends on this shard (ADR-0023 decision 4). */
  normative: boolean;
  ir: unknown;
  /** IR path → span of the record that produced it, so a contract error can name a line (ADR-0020 D8). */
  sources?: SourceMap | undefined;
}

/** Compile every description of the project that has a producer today. */
export function buildIrTree(root: string): IrTree {
  const drafts: Draft[] = [];
  const diagnostics: Diagnostic[] = [];
  const components = loadComponents(root);
  const resolver = components.resolver;
  const modules = loadModules(root);
  /** Per-board UID declarations, checked across the project before hashes are computed (ADR-0051). */
  const uidInputs: ProjectUidInput[] = [];

  // The devices: one shard per file, at `components/<id>.json`. A component is a fact of the build
  // (the board is made of these parts), so it is normative.
  diagnostics.push(...components.diagnostics);
  for (const shard of components.shards) {
    drafts.push({
      // Every device is the project's own file, so every device shard sits at `components/<id>.json`
      // (ADR-0031 decision 9: layout by kind; ADR-0047: there is no library namespace).
      path: `components/${shard.id}.json`,
      kind: "component",
      source: shard.file,
      normative: true,
      ir: shard.ir,
      sources: shard.sources,
    });
  }

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
    uidInputs.push({
      board,
      file: loaded.file,
      ...(schematic.sourceUids === undefined ? {} : { sourceUids: schematic.sourceUids }),
      ...(schematic.ir === undefined ? {} : { ir: schematic.ir }),
      ...(schematic.sources === undefined ? {} : { sources: schematic.sources }),
    });
    if (schematic.ir) {
      drafts.push({
        path: `boards/${board}/schematic.json`,
        kind: "schematic",
        source: loaded.file,
        normative: true,
        ir: schematic.ir,
        sources: schematic.sources,
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
          normative: true,
          ir: parsed.ir,
          sources: parsed.sources,
        });
      }
    }

    // The procurement layer: which parts this board is built from (normative) and which parts
    // could replace them (advisory). A second source does not change the build, so only the
    // primary enters the build identity (ADR-0030 decision 12, ADR-0023 decision 4).
    for (const role of PROCUREMENT_ROLES) {
      const procurement = loadProcurement(root, board, role);
      if (!procurement) continue;
      const parsed = parseProcurement(procurement.text, {
        file: procurement.file,
        board,
        role,
        components: resolver,
      });
      diagnostics.push(...parsed.diagnostics);
      if (parsed.ir) {
        drafts.push({
          path: `boards/${board}/procurement${role === "alternatives" ? "-alternatives" : ""}.json`,
          kind: "procurement",
          source: procurement.file,
          normative: role === "primary",
          ir: parsed.ir,
          sources: parsed.sources,
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
          // A print page is a drawing, not a build input: nothing that is built depends on where
          // a label sits (ADR-0032 decision 3).
          normative: false,
          ir: parsed.ir,
          sources: parsed.sources,
        });
      }
    }
  }

  const libraries: {
    kind: SchemaKind;
    dir: string;
    /** Directory of the shard tree (independent of the source tree). */
    shardDir: string;
    parse: (text: string, options: { file: string; library: string }) => {
      ir?: unknown;
      diagnostics: Diagnostic[];
      sources?: SourceMap;
    };
  }[] = [
    // The source directory follows the tree; the shard path stays by kind (ADR-0031 decision 4).
    { kind: "symbol", dir: LAYOUT.symbols, shardDir: "symbols", parse: parseSymbol },
    { kind: "footprint", dir: LAYOUT.footprints, shardDir: "footprints", parse: parseFootprint },
  ];
  for (const { kind, dir, shardDir, parse } of libraries) {
    for (const file of libraryFiles(root, dir)) {
      const library = file.library;
      const parsed = parse(readFileSync(file.path, "utf8"), {
        file: file.source,
        library,
      });
      diagnostics.push(...parsed.diagnostics);
      if (!parsed.ir) continue;
      drafts.push({
        path: `${shardDir}/${library}/${file.id}.json`,
        kind,
        source: file.source,
        normative: true,
        ir: parsed.ir,
        sources: parsed.sources,
      });
    }
  }

  // The project file: the project's own metadata, the board list, the variants.
  const project = loadProject(root);
  diagnostics.push(...project.diagnostics);
  if (project.ir) {
    drafts.push({
      path: "project.json",
      kind: "project",
      source: "project.toml",
      normative: true,
      ir: project.ir,
    });
  }

  // The systems: how the boards are wired to each other. A system is part of the design, so it
  // enters the build identity.
  for (const source of listSystems(root)) {
    const parsed = parseSystem(readFileSync(join(root, source.file), "utf8"), { file: source.file });
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.ir) continue;
    drafts.push({
      path: `systems/${source.systemId}.json`,
      kind: "system",
      source: source.file,
      normative: true,
      ir: parsed.ir,
    });
  }

  diagnostics.push(...checkProjectInstanceUids(uidInputs));

  // A procurement file belongs to a board: one whose design exists (spec/procurement.md §1).
  const boards = new Set(listBoards(root));
  for (const file of listProcurement(root)) {
    if (boards.has(file.board)) continue;
    diagnostics.push({
      code: "ref.unknown-board",
      severity: "error",
      message: `board ${file.board} not found: ${file.file} selects parts for a board this project does not have`,
      hint: `a procurement file belongs to a board: use the board id of a design/sch/${file.board}.teda file`,
      location: { file: file.file, line: 2, col: 1 },
    });
  }

  const shards: IrShard[] = [];
  const validDrafts: Draft[] = [];
  for (const draft of drafts) {
    const check = validate(draft.kind, draft.ir);
    if (!check.ok) {
      diagnostics.push(...schemaDiagnosticsToDiagnostics(check.errors, locateWith(draft.sources)));
      continue;
    }
    validDrafts.push(draft);
    const bytes = canonicalJson(draft.ir);
    shards.push({
      path: draft.path,
      kind: draft.kind,
      source: draft.source,
      normative: draft.normative,
      bytes,
      sha256: sha256Hex(bytes),
    });
  }
  shards.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const entries = shards.map((shard) => ({
    path: shard.path,
    sha256: shard.sha256,
    normative: shard.normative,
  }));
  // The project hash identifies the build, so it covers the normative shards only; the advisory
  // hash covers everything else (ADR-0023 decision 4, amended 2026-10-22).
  const normative = entries.filter((entry) => entry.normative);
  const advisory = entries.filter((entry) => !entry.normative);
  const projectHash = aggregateShardHash(normative);
  const advisoryHash = advisory.length > 0 ? aggregateShardHash(advisory) : undefined;
  const boardHashes = new Map<string, string>();
  for (const board of listBoards(root)) {
    const prefix = `boards/${board}/`;
    const subset = normative.filter((entry) => entry.path.startsWith(prefix));
    if (subset.length > 0) boardHashes.set(board, aggregateShardHash(subset));
  }

  const manifest: IrManifest = {
    ir_version: IR_VERSION,
    tool_version: toolVersion(),
    shards: entries,
    source_hash: projectHash,
    ...(advisoryHash === undefined ? {} : { advisory_hash: advisoryHash }),
  };

  // The manifest is itself a shard of the contract; check it before anything is written. An empty
  // manifest cannot satisfy the contract (it lists at least one shard), so an empty project is
  // reported as such instead of as a contract violation.
  if (shards.length === 0) {
    diagnostics.push({
      code: "cli.empty-project",
      severity: "error",
      message: `No description with a producer was found in ${root}`,
      hint: "Add a board description (design/sch/<board_id>.teda), a PCB description, or a library file; or point at the right project directory",
    });
  } else {
    const manifestCheck = validate("manifest", manifest);
    if (!manifestCheck.ok) diagnostics.push(...schemaDiagnosticsToDiagnostics(manifestCheck.errors));
  }

  const identity = buildIdentityDocument(validDrafts);
  return { shards, manifest, projectHash, advisoryHash, boardHashes, diagnostics, identity };
}

/**
 * Write the tree: one canonical JSON file per shard, plus `manifest.json`.
 *
 * Files under the output directory that the tree does not own are removed, so a deleted source
 * file does not leave a stale shard behind (a stale shard would change the project hash).
 */
export function writeIrTree(outDir: string, tree: IrTree): void {
  mkdirSync(outDir, { recursive: true });
  const owned = new Set<string>(["manifest.json", "identity.json"]);
  for (const shard of tree.shards) {
    const target = join(outDir, shard.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, shard.bytes);
    owned.add(shard.path);
  }
  writeFileSync(join(outDir, "manifest.json"), canonicalJson(tree.manifest));
  writeFileSync(join(outDir, "identity.json"), canonicalJson(tree.identity));
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
