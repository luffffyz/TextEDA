// `texteda renumber`: a code-executed global rename of reference designators (ADR-0050).
//
// This is deliberately not `fmt`: the formatter only changes layout, while a renumbering changes
// names and therefore the project hash. The command computes one mapping, validates it, rewrites
// every machine-readable reference it can see, formats the touched sources, and only writes when
// `--apply` is given.
//
// What is renamed:
//   - component refdes rows in a board (`R1`, `C7`, `U3`, ...);
//   - component refdes rows inside a module definition (`R1`, ...). A module's refdes is local to
//     its definition, so one mapping updates every `M<tag>.<old>` reference in every board that
//     uses that module.
//
// What is not renamed (ADR-0050 decision 5 and "What this does not do"):
//   - module instance tags (`M1`, `M2`), net names, port names, component ids, symbol/footprint ids;
//   - prose. Markdown is searched and reported, never edited.
//
// References that follow a rename:
//   - schematic net members and bus members, including pin references (`U1.2.OUT`, `M1.U1.6`);
//   - the pin subject of a `voltage`/`current`/`power` constraint (`power R1.1 2mW`);
//   - view `place` rows and the pin references in `wire` rows;
//   - pcb `place` rows and `connect` pad references;
//   - variant entries in `project.toml` that name an instance.
//
// A view wire's first column is a net name, not an instance: `M2.BOOT` must stay untouched even
// though it has the same shape as a module-qualified instance. The same applies to a two-segment
// `M1.X` in a net/bus row (a module port) and to a constraint subject that names a net. The source
// editor therefore walks sections and columns instead of replacing tokens over the whole text.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import {
  formatPcb,
  formatSchematic,
  formatView,
  lex,
  naturalCompare,
  parsePcb,
  parseSchematicDocument,
  parseView,
  type Cell,
  type Document,
  type ModuleSource,
} from "@texteda/parser";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { checkProject } from "./check.ts";
import { buildIrTree } from "./ir-tree.ts";
import { LAYOUT } from "./paths.ts";
import { listBoards, loadBoard, loadModules, loadPcb } from "./project.ts";

export type RenumberPolicy = "preserve" | "compact" | "position";

export interface RenumberOptions {
  /** Project root. */
  root: string;
  /** Board whose component refdes are renumbered. */
  board: string;
  /** Policy used when `mapping` is absent. Defaults to `compact`. */
  policy?: RenumberPolicy;
  /** Explicit old -> new mapping file; mutually exclusive with `policy`. */
  mapping?: string;
  /** Write the result. Without this the command is a dry run. */
  apply?: boolean;
  /** Print a machine-readable report. */
  json?: boolean;
}

export interface RenumberChange {
  /** `board` for a board-level refdes, otherwise the module definition id. */
  namespace: string;
  old: string;
  new: string;
}

export interface MarkdownHit {
  file: string;
  line: number;
  old: string;
  new: string;
}

export interface RenumberReport {
  board: string;
  policy: RenumberPolicy | "mapping";
  applied: boolean;
  changes: RenumberChange[];
  files: string[];
  markdown: MarkdownHit[];
  project_hash: { before: string; after: string };
  advisory_hash: { before: string | null; after: string | null };
  check: { errors: number; warnings: number } | null;
}

class RenumberError extends Error {}

interface BoardContext {
  id: string;
  file: string;
  text: string;
  doc: Document;
  views: { file: string; text: string }[];
  pcb: { file: string; text: string } | null;
  /** A module tag in this board -> the module definition it instantiates. */
  moduleByTag: Map<string, string>;
}

interface ProjectContext {
  root: string;
  target: BoardContext;
  boards: BoardContext[];
  modules: Map<string, ModuleSource>;
}

interface NameMaps {
  /** Board-level component refdes. Module tags are never in this map. */
  board: Map<string, string>;
  /** Module definition id -> local refdes map. */
  modules: Map<string, Map<string, string>>;
}

interface Edit {
  line: number;
  col: number;
  old: string;
  new: string;
}

interface SourceEdit {
  file: string;
  before: string;
  after: string;
  /** Whether at least one token changed (formatting alone is not a reason to rewrite a file). */
  changed: boolean;
}

interface Placement {
  page: string;
  x: number;
  y: number;
}

const REFDES_RE = /^([A-Za-z]+)([0-9]+)$/;

function fail(message: string): never {
  throw new RenumberError(message);
}

/** Split a refdes or module tag into its alphabetic prefix and numeric suffix. */
function splitPrefix(name: string): { prefix: string; number: number } {
  const match = REFDES_RE.exec(name);
  if (!match) fail(`cannot renumber ${name}: a reference designator is a letter prefix plus digits`);
  return { prefix: match[1]!, number: Number(match[2]!) };
}

function naturalNames(names: readonly string[]): string[] {
  return [...names].sort(naturalCompare);
}

function mapFromNames(names: readonly string[]): Map<string, string> {
  return new Map(names.map((name) => [name, name]));
}

function hasChanges(map: ReadonlyMap<string, string>): boolean {
  for (const [old, next] of map) if (old !== next) return true;
  return false;
}

function parseDoc(text: string, file: string, kind: "schematic" | "module"): Document {
  const parsed = parseSchematicDocument(text, { file, kind });
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0 || !parsed.doc) {
    const first = errors[0];
    fail(`${file}: ${first ? `${first.code}: ${first.message}` : "could not be parsed"}`);
  }
  return parsed.doc;
}

function parseViews(board: BoardContext): void {
  for (const view of board.views) {
    const parsed = parseView(view.text, { file: view.file, board: board.id });
    const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      const first = errors[0]!;
      fail(`${view.file}: ${first.code}: ${first.message}`);
    }
  }
  if (board.pcb) {
    const parsed = parsePcb(board.pcb.text, { file: board.pcb.file, board: board.id });
    const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      const first = errors[0]!;
      fail(`${board.pcb.file}: ${first.code}: ${first.message}`);
    }
  }
}

/** Read every board, module and view once. `buildIrTree` has already rejected an invalid project. */
function loadContext(root: string, targetId: string): ProjectContext {
  const moduleSources = loadModules(root);
  const modules = new Map(moduleSources.map((source) => [source.moduleId, source]));
  const boards: BoardContext[] = [];
  for (const id of listBoards(root)) {
    const loaded = loadBoard(root, id);
    if (!loaded) continue;
    const doc = parseDoc(loaded.text, loaded.file, "schematic");
    const pcbLoaded = loadPcb(root, id);
    const board: BoardContext = {
      id,
      file: loaded.file,
      text: loaded.text,
      doc,
      views: loaded.views.map((view) => ({ file: view.file, text: view.text })),
      pcb: pcbLoaded ? { file: pcbLoaded.file, text: pcbLoaded.text } : null,
      moduleByTag: new Map(doc.modules.map((module) => [module.instanceId, module.moduleId])),
    };
    parseViews(board);
    boards.push(board);
  }
  const target = boards.find((board) => board.id === targetId);
  if (!target) fail(`board ${targetId} has no schematic file (${LAYOUT.sch}/${targetId}.teda)`);
  for (const moduleId of new Set(target.doc.modules.map((module) => module.moduleId))) {
    if (!modules.has(moduleId)) fail(`board ${targetId} uses module ${moduleId}, but ${LAYOUT.modules}/${moduleId}.teda does not exist`);
  }
  return { root, target, boards, modules };
}

function placementMap(board: BoardContext): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  for (const view of board.views) {
    const parsed = parseView(view.text, { file: view.file, board: board.id });
    if (!parsed.ir) continue;
    for (const item of parsed.ir.place) {
      const next = { page: view.file, x: item.x_nm, y: item.y_nm };
      const previous = placements.get(item.instance_id);
      if (previous && (previous.x !== next.x || previous.y !== next.y)) {
        fail(
          `position is ambiguous for ${board.id}/${item.instance_id}: it is placed at both ${previous.page} and ${next.page}; use --mapping`,
        );
      }
      if (!previous) placements.set(item.instance_id, next);
    }
  }
  return placements;
}

function orderByPlacement(
  names: readonly string[],
  placementOf: (name: string) => Placement | undefined,
): string[] {
  const placed: { name: string; placement: Placement }[] = [];
  const unplaced: string[] = [];
  for (const name of names) {
    const placement = placementOf(name);
    if (placement) placed.push({ name, placement });
    else unplaced.push(name);
  }
  placed.sort((a, b) => {
    if (a.placement.y !== b.placement.y) return a.placement.y - b.placement.y;
    if (a.placement.x !== b.placement.x) return a.placement.x - b.placement.x;
    return naturalCompare(a.name, b.name);
  });
  return [...placed.map((item) => item.name), ...naturalNames(unplaced)];
}

function compactMap(names: readonly string[]): Map<string, string> {
  const byPrefix = new Map<string, string[]>();
  for (const name of names) {
    const { prefix } = splitPrefix(name);
    const group = byPrefix.get(prefix);
    if (group) group.push(name);
    else byPrefix.set(prefix, [name]);
  }
  const map = new Map<string, string>();
  for (const [prefix, group] of byPrefix) {
    const ordered = naturalNames(group);
    ordered.forEach((old, index) => map.set(old, `${prefix}${index + 1}`));
  }
  return map;
}

function positionModuleMap(
  moduleId: string,
  names: readonly string[],
  tags: readonly string[],
  placements: Map<string, Placement>,
): Map<string, string> {
  const byPosition = new Map<string, Placement>();
  for (const name of names) {
    const seen = new Map<string, Placement>();
    for (const tag of tags) {
      const placement = placements.get(`${tag}.${name}`);
      if (placement) seen.set(`${placement.page}:${placement.x}:${placement.y}`, placement);
    }
    if (seen.size > 1) {
      fail(
        `position is ambiguous for ${moduleId}/${name}: module instances ${tags.join(", ")} place it at different coordinates; use --mapping`,
      );
    }
    const first = seen.values().next().value as Placement | undefined;
    if (first) byPosition.set(name, first);
  }
  const ordered = orderByPlacement(names, (name) => byPosition.get(name));
  const byPrefix = new Map<string, string[]>();
  for (const name of ordered) {
    const { prefix } = splitPrefix(name);
    const group = byPrefix.get(prefix);
    if (group) group.push(name);
    else byPrefix.set(prefix, [name]);
  }
  const map = new Map<string, string>();
  for (const [prefix, group] of byPrefix) group.forEach((old, index) => map.set(old, `${prefix}${index + 1}`));
  return map;
}

function computePolicyMaps(context: ProjectContext, policy: RenumberPolicy): NameMaps {
  const boardNames = context.target.doc.instances.map((instance) => instance.refdes);
  const maps: NameMaps = { board: new Map(), modules: new Map() };

  if (policy === "preserve") {
    maps.board = mapFromNames(boardNames);
    return maps;
  }

  if (policy === "compact") {
    maps.board = compactMap(boardNames);
    for (const moduleId of new Set(context.target.doc.modules.map((module) => module.moduleId))) {
      const source = context.modules.get(moduleId)!;
      const doc = parseDoc(source.text, source.file, "module");
      maps.modules.set(moduleId, compactMap(doc.instances.map((instance) => instance.refdes)));
    }
    return maps;
  }

  // position
  const placements = placementMap(context.target);
  if (placements.size === 0) {
    fail(
      `position policy needs a view with place rows: board ${context.target.id} has no print page placement; use compact, preserve, or --mapping`,
    );
  }
  const orderedBoard = orderByPlacement(boardNames, (name) => placements.get(name));
  const boardByPrefix = new Map<string, string[]>();
  for (const name of orderedBoard) {
    const { prefix } = splitPrefix(name);
    const group = boardByPrefix.get(prefix);
    if (group) group.push(name);
    else boardByPrefix.set(prefix, [name]);
  }
  for (const [prefix, group] of boardByPrefix) {
    group.forEach((old, index) => maps.board.set(old, `${prefix}${index + 1}`));
  }

  for (const moduleId of new Set(context.target.doc.modules.map((module) => module.moduleId))) {
    const source = context.modules.get(moduleId)!;
    const doc = parseDoc(source.text, source.file, "module");
    const tags = context.target.doc.modules
      .filter((module) => module.moduleId === moduleId)
      .map((module) => module.instanceId);
    maps.modules.set(
      moduleId,
      positionModuleMap(
        moduleId,
        doc.instances.map((instance) => instance.refdes),
        tags,
        placements,
      ),
    );
  }
  return maps;
}

/** Parse `old new` lines; a module-local name is written `module_id/refdes`. */
function parseMappingFile(path: string): { board: Map<string, string>; modules: Map<string, Map<string, string>> } {
  if (!existsSync(path)) fail(`mapping file does not exist: ${path}`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    fail(`cannot read mapping file ${path}: ${code === "EISDIR" ? "is a directory" : (code ?? "read failed")}`);
  }
  const board = new Map<string, string>();
  const modules = new Map<string, Map<string, string>>();
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 2) fail(`${path}:${index + 1}: a mapping line is \`<old> <new>\``);
    const [old, next] = parts as [string, string];
    if (old.includes("/")) {
      const slash = old.indexOf("/");
      const moduleId = old.slice(0, slash);
      const local = old.slice(slash + 1);
      if (moduleId === "" || local === "") fail(`${path}:${index + 1}: a module-local mapping is \`<module_id>/<old>\``);
      if (next.includes("/")) fail(`${path}:${index + 1}: the new name must be a bare refdes`);
      const map = modules.get(moduleId);
      if (map?.has(local)) fail(`${path}:${index + 1}: duplicate mapping for ${old}`);
      if (map) map.set(local, next);
      else modules.set(moduleId, new Map([[local, next]]));
    } else {
      if (next.includes("/")) fail(`${path}:${index + 1}: the new name must be a bare refdes`);
      if (board.has(old)) fail(`${path}:${index + 1}: duplicate mapping for ${old}`);
      board.set(old, next);
    }
  }
  return { board, modules };
}

function validateMaps(context: ProjectContext, maps: NameMaps, policy: string): void {
  const boardNames = context.target.doc.instances.map((instance) => instance.refdes);

  const validateNamespace = (
    namespace: string,
    current: readonly string[],
    map: Map<string, string>,
  ): void => {
    const currentSet = new Set(current);
    const stale: string[] = [];
    for (const [old, next] of map) {
      if (!currentSet.has(old)) {
        // A mapping whose old name is gone and whose new name is present has already been applied.
        // That is what makes a second run with the same explicit mapping a no-op (ADR-0050 D4).
        if (currentSet.has(next)) {
          stale.push(old);
          continue;
        }
        fail(`${policy}: ${namespace}/${old} is not an instance in this namespace`);
      }
      const oldParts = splitPrefix(old);
      const newParts = splitPrefix(next);
      if (oldParts.prefix !== newParts.prefix) {
        fail(`${policy}: ${namespace}/${old} -> ${next} changes the prefix (${oldParts.prefix} -> ${newParts.prefix})`);
      }
    }
    for (const old of stale) map.delete(old);
    const final = new Map<string, string>();
    for (const old of current) {
      const next = map.get(old) ?? old;
      const duplicate = final.get(next);
      if (duplicate !== undefined) {
        fail(`${policy}: ${namespace}/${next} would be assigned to both ${duplicate} and ${old}`);
      }
      final.set(next, old);
    }
  };

  validateNamespace("board", boardNames, maps.board);
  for (const moduleId of new Set(context.target.doc.modules.map((module) => module.moduleId))) {
    const source = context.modules.get(moduleId)!;
    const doc = parseDoc(source.text, source.file, "module");
    const local = maps.modules.get(moduleId);
    if (local) validateNamespace(moduleId, doc.instances.map((instance) => instance.refdes), local);
  }
  // A board-level name may not become a module tag: module tags are outside this namespace and are
  // never renumbered.
  const tags = new Set(context.target.doc.modules.map((module) => module.instanceId));
  for (const next of maps.board.values()) {
    if (tags.has(next)) fail(`${policy}: board refdes ${next} collides with a module instance tag`);
  }
}

function mapRef(
  ref: string,
  boardMap: ReadonlyMap<string, string>,
  moduleByTag: ReadonlyMap<string, string>,
  moduleMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  localMap?: ReadonlyMap<string, string>,
  moduleRefs = true,
): string {
  const parts = ref.split(".");
  if (localMap !== undefined) {
    const next = localMap.get(parts[0]!);
    if (next === undefined) return ref;
    return [next, ...parts.slice(1)].join(".");
  }
  const tag = parts[0]!;
  const moduleId = moduleByTag.get(tag);
  if (moduleId !== undefined) {
    const local = parts[1];
    if (local === undefined) return ref;
    // In a net/bus row and in a constraint subject, `M1.X` is a port or a net name, not an
    // instance: only the three-or-more-segment form (`M1.U1.6`) carries a refdes (spec/module.md).
    if (!moduleRefs && parts.length === 2) return ref;
    const localMap = moduleMaps.get(moduleId);
    const next = localMap?.get(local);
    if (next === undefined) return ref;
    return [tag, next, ...parts.slice(2)].join(".");
  }
  const next = boardMap.get(tag);
  if (next === undefined) return ref;
  return [next, ...parts.slice(1)].join(".");
}

/** The columns of a net/bus row that are member references, using the same split rules as the parser. */
function memberStart(cells: readonly Cell[]): number {
  if (cells.length === 0) return 0;
  if (cells[0]!.text === ":") return 1;
  if (cells[0]!.text.endsWith(":")) return 1;
  if (cells[1]?.text === ":") return 2;
  return 1;
}

function pushIfChanged(edits: Edit[], line: number, cell: Cell | undefined, next: string | undefined): void {
  if (!cell || next === undefined || next === cell.text) return;
  edits.push({ line, col: cell.col, old: cell.text, new: next });
}

/** Rewrite the instance and pin-ref columns of a schematic or module source. */
function editSchematicSource(
  text: string,
  file: string,
  kind: "schematic" | "module",
  boardMap: ReadonlyMap<string, string>,
  moduleByTag: ReadonlyMap<string, string>,
  moduleMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
  localMap?: ReadonlyMap<string, string>,
  netNames: ReadonlySet<string> = new Set(),
): { text: string; changed: boolean } {
  const edits: Edit[] = [];
  const sectionNames = new Set(["instances", "nets", "ports", "constraints", "bus", "modules"]);
  let section: string | null = null;
  for (const line of lex(text)) {
    if (line.blank || line.comment) continue;
    const first = line.cells[0];
    if (!first) continue;
    if (first.text === "version" || first.text === "schematic" || first.text === "module") continue;
    if (sectionNames.has(first.text) && (first.text !== "bus" || line.cells.length === 1)) {
      section = first.text;
      if (first.text === "bus") {
        // `bus <id> = <type>` opens the bus block; rows follow.
        continue;
      }
      if (first.text === "modules" || first.text === "ports" || first.text === "constraints") continue;
      continue;
    }
    if (first.text === "bus" && line.cells.length > 1) {
      section = "bus";
      continue;
    }
    if (section === null) continue;
    if (section === "instances") {
      // Board-level refdes only. A module file has only local refdes, which the same map handles.
      pushIfChanged(
        edits,
        line.number,
        line.cells[0],
        kind === "module"
          ? (localMap?.get(first.text) ?? first.text)
          : mapRef(first.text, boardMap, moduleByTag, moduleMaps),
      );
      continue;
    }
    if (section === "nets" || section === "bus") {
      const start = memberStart(line.cells);
      for (let index = start; index < line.cells.length; index++) {
        const cell = line.cells[index]!;
        pushIfChanged(
          edits,
          line.number,
          cell,
          mapRef(cell.text, boardMap, moduleByTag, moduleMaps, localMap, false),
        );
      }
      continue;
    }
    if (section === "constraints") {
      // voltage/current/power take a pin or a net. A net name that looks like a pin (`R1.1`) is
      // resolved as a net by the parser, so leave every net subject untouched; only the pin form
      // is an instance reference. impedance/length/diff/skew are net-only.
      const subject = line.cells[1];
      if (
        subject &&
        (first.text === "voltage" || first.text === "current" || first.text === "power") &&
        !netNames.has(subject.text)
      ) {
        pushIfChanged(
          edits,
          line.number,
          subject,
          mapRef(subject.text, boardMap, moduleByTag, moduleMaps, localMap, false),
        );
      }
    }
  }
  const edited = applyEdits(text, edits);
  const formatted = formatSchematic(edited, { file, kind });
  const errors = formatted.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0 || formatted.text === undefined) {
    const first = errors[0];
    fail(`${file}: formatter refused the edited source${first ? ` (${first.code}: ${first.message})` : ""}`);
  }
  return { text: formatted.text, changed: edits.length > 0 };
}

/** Rewrite the instance columns of a view. Wire/label/port net columns are deliberately untouched. */
function editViewSource(
  text: string,
  file: string,
  board: BoardContext,
  boardMap: ReadonlyMap<string, string>,
  moduleMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): { text: string; changed: boolean } {
  const edits: Edit[] = [];
  let section: string | null = null;
  for (const line of lex(text)) {
    if (line.blank || line.comment) continue;
    const first = line.cells[0];
    if (!first) continue;
    if (first.text === "version" || first.text === "view") continue;
    if (["place", "wire", "label", "port", "text"].includes(first.text) && line.cells.length === 1) {
      section = first.text;
      continue;
    }
    if (section === "place") {
      pushIfChanged(edits, line.number, line.cells[0], mapRef(first.text, boardMap, board.moduleByTag, moduleMaps));
    } else if (section === "wire") {
      // wire <net> <pin-a> <pin-b> [x y ...]: only the two pin columns.
      pushIfChanged(edits, line.number, line.cells[1], line.cells[1] ? mapRef(line.cells[1].text, boardMap, board.moduleByTag, moduleMaps) : undefined);
      pushIfChanged(edits, line.number, line.cells[2], line.cells[2] ? mapRef(line.cells[2].text, boardMap, board.moduleByTag, moduleMaps) : undefined);
    }
  }
  const edited = applyEdits(text, edits);
  const formatted = formatView(edited, { file });
  const errors = formatted.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0 || formatted.text === undefined) {
    const first = errors[0];
    fail(`${file}: formatter refused the edited source${first ? ` (${first.code}: ${first.message})` : ""}`);
  }
  return { text: formatted.text, changed: edits.length > 0 };
}

/** Rewrite pcb place and connect references; nets, layers, coordinates and rules stay untouched. */
function editPcbSource(
  text: string,
  file: string,
  board: BoardContext,
  boardMap: ReadonlyMap<string, string>,
  moduleMaps: ReadonlyMap<string, ReadonlyMap<string, string>>,
): { text: string; changed: boolean } {
  const edits: Edit[] = [];
  let section: string | null = null;
  for (const line of lex(text)) {
    if (line.blank || line.comment) continue;
    const first = line.cells[0];
    if (!first) continue;
    if (first.text === "version" || first.text === "pcb") continue;
    if (
      ["stackup", "outline", "place", "connect", "trace", "via", "zone", "keepout", "rules", "silk", "physical_only", "deviation"].includes(
        first.text,
      ) &&
      line.cells.length === 1
    ) {
      section = first.text;
      continue;
    }
    if (section === "place") {
      pushIfChanged(edits, line.number, line.cells[0], mapRef(first.text, boardMap, board.moduleByTag, moduleMaps));
    } else if (section === "connect") {
      for (const index of [0, 1]) {
        const cell = line.cells[index];
        pushIfChanged(edits, line.number, cell, cell ? mapRef(cell.text, boardMap, board.moduleByTag, moduleMaps) : undefined);
      }
    }
  }
  const edited = applyEdits(text, edits);
  const formatted = formatPcb(edited, { file });
  const errors = formatted.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0 || formatted.text === undefined) {
    const first = errors[0];
    fail(`${file}: formatter refused the edited source${first ? ` (${first.code}: ${first.message})` : ""}`);
  }
  return { text: formatted.text, changed: edits.length > 0 };
}

/** Apply column replacements from the end of each line so earlier columns keep their indices. */
function applyEdits(text: string, edits: readonly Edit[]): string {
  if (edits.length === 0) return text;
  const lines = text.split("\n");
  const byLine = new Map<number, Edit[]>();
  for (const edit of edits) {
    const group = byLine.get(edit.line);
    if (group) group.push(edit);
    else byLine.set(edit.line, [edit]);
  }
  for (const [lineNumber, group] of byLine) {
    const index = lineNumber - 1;
    const original = lines[index];
    if (original === undefined) fail(`internal error: edit on missing line ${lineNumber}`);
    let chars = [...original];
    group.sort((a, b) => b.col - a.col);
    for (const edit of group) {
      const start = edit.col - 1;
      const actual = chars.slice(start, start + [...edit.old].length).join("");
      if (actual !== edit.old) {
        fail(`internal error: line ${lineNumber} column ${edit.col} is ${JSON.stringify(actual)}, expected ${JSON.stringify(edit.old)}`);
      }
      chars = [...chars.slice(0, start), ...[...edit.new], ...chars.slice(start + [...edit.old].length)];
    }
    lines[index] = chars.join("");
  }
  return lines.join("\n");
}

/** Every net id a document declares, including bus member nets. */
function documentedNetNames(doc: Document): Set<string> {
  const names = new Set<string>();
  for (const net of doc.nets) names.add(net.name);
  for (const bus of doc.buses) for (const member of bus.members) names.add(`${bus.id}.${member.member}`);
  return names;
}

/** A board's nets plus the module-local nets it can name after flattening (`M1.NET`). */
function boardNetNames(board: BoardContext, modules: ReadonlyMap<string, ModuleSource>): Set<string> {
  const names = documentedNetNames(board.doc);
  for (const module of board.doc.modules) {
    const source = modules.get(module.moduleId);
    if (!source) continue;
    const doc = parseDoc(source.text, source.file, "module");
    for (const name of documentedNetNames(doc)) names.add(`${module.instanceId}.${name}`);
  }
  return names;
}

/** The old full names and their new names, for project variants and the Markdown report. */
function fullNameMap(context: ProjectContext, maps: NameMaps): Map<string, string> {
  const out = new Map<string, string>();
  for (const [old, next] of maps.board) if (old !== next) out.set(old, next);
  for (const board of context.boards) {
    for (const [tag, moduleId] of board.moduleByTag) {
      const localMap = maps.modules.get(moduleId);
      if (!localMap) continue;
      for (const [old, next] of localMap) {
        if (old === next) continue;
        out.set(`${tag}.${old}`, `${tag}.${next}`);
      }
    }
  }
  return out;
}

/** Replace quoted variant strings only inside `[variants.*]` tables. */
export function editProjectVariants(text: string, names: ReadonlyMap<string, string>): { text: string; changed: boolean } {
  if (names.size === 0) return { text, changed: false };
  const lines = text.split("\n");
  let inVariants = false;
  let inArray = false;
  let changed = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inVariants = /^\[+variants\./.test(trimmed);
      inArray = false;
      continue;
    }
    if (!inVariants) continue;
    const assignment = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    const key = assignment?.[1];
    const value = assignment?.[2] ?? "";
    const replace = key === "dnp" || key === "nofit" || key === "from" || key === "to" || (inArray && key === undefined);
    if (replace) {
      let out = "";
      let i = 0;
      while (i < line.length) {
        const ch = line[i]!;
        if (ch === "#") {
          out += line.slice(i);
          break;
        }
        if (ch === '"' || ch === "'") {
          const quote = ch;
          let j = i + 1;
          let valueText = "";
          while (j < line.length) {
            const c = line[j]!;
            if (c === "\\" && quote === '"' && j + 1 < line.length) {
              valueText += c + line[j + 1]!;
              j += 2;
              continue;
            }
            if (c === quote) break;
            valueText += c;
            j += 1;
          }
          if (j < line.length) {
            const next = names.get(valueText);
            if (next !== undefined && next !== valueText) {
              out += `${quote}${next}${quote}`;
              changed = true;
            } else {
              out += line.slice(i, j + 1);
            }
            i = j + 1;
            continue;
          }
        }
        out += ch;
        i += 1;
      }
      lines[index] = out;
    }
    if (key === "dnp" || key === "nofit") {
      inArray = value.includes("[") && !value.includes("]");
    } else if (inArray) {
      if (line.includes("]")) inArray = false;
    } else if (key !== undefined) {
      inArray = false;
    }
  }
  return { text: lines.join("\n"), changed };
}

function editsForProject(context: ProjectContext, maps: NameMaps): { edits: SourceEdit[]; names: Map<string, string> } {
  const edits: SourceEdit[] = [];
  const names = fullNameMap(context, maps);
  for (const board of context.boards) {
    const boardMap = board.id === context.target.id ? maps.board : new Map<string, string>();
    const edit = editSchematicSource(
      board.text,
      board.file,
      "schematic",
      boardMap,
      board.moduleByTag,
      maps.modules,
      undefined,
      boardNetNames(board, context.modules),
    );
    if (edit.changed) edits.push({ file: board.file, before: board.text, after: edit.text, changed: true });
    for (const view of board.views) {
      const viewEdit = editViewSource(view.text, view.file, board, boardMap, maps.modules);
      if (viewEdit.changed) edits.push({ file: view.file, before: view.text, after: viewEdit.text, changed: true });
    }
    if (board.pcb) {
      const pcbEdit = editPcbSource(board.pcb.text, board.pcb.file, board, boardMap, maps.modules);
      if (pcbEdit.changed) edits.push({ file: board.pcb.file, before: board.pcb.text, after: pcbEdit.text, changed: true });
    }
  }
  for (const [moduleId, map] of maps.modules) {
    if (!hasChanges(map)) continue;
    const source = context.modules.get(moduleId);
    if (!source) fail(`module ${moduleId} is missing`);
    const sourceDoc = parseDoc(source.text, source.file, "module");
    const edit = editSchematicSource(
      source.text,
      source.file,
      "module",
      new Map(),
      new Map(),
      maps.modules,
      map,
      documentedNetNames(sourceDoc),
    );
    if (edit.changed) edits.push({ file: source.file, before: source.text, after: edit.text, changed: true });
  }
  const projectFile = join(context.root, "project.toml");
  if (existsSync(projectFile) && names.size > 0) {
    const before = readFileSync(projectFile, "utf8");
    const variantEdit = editProjectVariants(before, names);
    if (variantEdit.changed) {
      edits.push({ file: relative(context.root, projectFile), before, after: variantEdit.text, changed: true });
    }
  }
  return { edits, names };
}

function hashOf(root: string): { project: string; advisory: string | null; diagnostics: Diagnostic[] } {
  const tree = buildIrTree(root);
  return {
    project: tree.projectHash,
    advisory: tree.advisoryHash ?? null,
    diagnostics: tree.diagnostics,
  };
}

function buildWithOverrides(root: string, overrides: readonly SourceEdit[]): { project: string; advisory: string | null } {
  const temp = mkdtempSync(join(tmpdir(), "texteda-renumber-"));
  try {
    for (const dir of ["assets", "design", "views"]) {
      const from = join(root, dir);
      if (existsSync(from)) cpSync(from, join(temp, dir), { recursive: true });
    }
    const project = join(root, "project.toml");
    if (existsSync(project)) cpSync(project, join(temp, "project.toml"));
    for (const edit of overrides) {
      const target = join(temp, edit.file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, edit.after);
    }
    const tree = buildIrTree(temp);
    const errors = tree.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0) {
      const first = errors[0]!;
      fail(`the renumbered project would not compile: ${first.code}: ${first.message}`);
    }
    return { project: tree.projectHash, advisory: tree.advisoryHash ?? null };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function writeAll(root: string, edits: readonly SourceEdit[]): void {
  const temps: { temp: string; path: string; before: string }[] = [];
  try {
    for (const [index, edit] of edits.entries()) {
      const path = join(root, edit.file);
      const temp = join(dirname(path), `.${basename(path)}.renumber-${process.pid}-${index}.tmp`);
      writeFileSync(temp, edit.after);
      temps.push({ temp, path, before: edit.before });
    }
    for (const item of temps) renameSync(item.temp, item.path);
  } catch (error) {
    for (const item of temps) {
      try {
        unlinkSync(item.temp);
      } catch {
        // The temp may already have been renamed; the original is restored below.
      }
      try {
        writeFileSync(item.path, item.before);
      } catch {
        // Best effort: the caller still gets the original error.
      }
    }
    throw error;
  }
}

function markdownHits(root: string, names: ReadonlyMap<string, string>): MarkdownHit[] {
  if (names.size === 0) return [];
  const files: string[] = [];
  const skip = new Set([".git", "dist", "node_modules"]);
  const walk = (path: string): void => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  };
  walk(root);
  const hits: MarkdownHit[] = [];
  for (const file of files.sort()) {
    const content = readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const [old, next] of names) {
        if (old === next) continue;
        const re = new RegExp(`(?<![A-Za-z0-9_.])${old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "g");
        if (re.test(line)) hits.push({ file: relative(root, file), line: index + 1, old, new: next });
      }
    }
  }
  return hits;
}

function report(report: RenumberReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Renumber ${report.board} (${report.policy}${report.applied ? ", applied" : ", dry run"})`);
  if (report.changes.length === 0) {
    console.log("No changes.");
  } else {
    for (const change of report.changes) {
      const prefix = change.namespace === "board" ? "" : `${change.namespace}/`;
      console.log(`  ${prefix}${change.old} -> ${change.new}`);
    }
  }
  if (report.files.length > 0) {
    console.log("Files:");
    for (const file of report.files) console.log(`  ${file}`);
  }
  console.log(`Project hash: ${report.project_hash.before} -> ${report.project_hash.after}`);
  console.log(`Advisory hash: ${report.advisory_hash.before ?? "none"} -> ${report.advisory_hash.after ?? "none"}`);
  if (report.markdown.length > 0) {
    console.log("Markdown still mentions old names (not edited):");
    for (const hit of report.markdown) console.log(`  ${hit.file}:${hit.line}: ${hit.old} -> ${hit.new}`);
  }
  if (report.check) {
    console.log(`Check: ${report.check.errors} errors, ${report.check.warnings} warnings`);
  }
}

export function runRenumber(options: RenumberOptions): number {
  try {
    if (!existsSync(options.root)) fail(`project directory does not exist: ${options.root}`);
    if (options.mapping !== undefined && options.policy !== undefined) {
      fail("--mapping and --policy are mutually exclusive");
    }
    const policy: RenumberPolicy | "mapping" = options.mapping !== undefined ? "mapping" : (options.policy ?? "compact");
    const before = hashOf(options.root);
    const beforeErrors = before.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (beforeErrors.length > 0) {
      const first = beforeErrors[0]!;
      fail(`project has errors; fix them before renumbering: ${first.code}: ${first.message}`);
    }

    const context = loadContext(options.root, options.board);
    let maps: NameMaps;
    if (policy === "mapping") {
      const parsed = parseMappingFile(options.mapping!);
      maps = { board: parsed.board, modules: parsed.modules };
      for (const moduleId of maps.modules.keys()) {
        if (!context.target.doc.modules.some((module) => module.moduleId === moduleId)) {
          fail(`mapping names module ${moduleId}, but board ${options.board} does not use it`);
        }
      }
    } else {
      maps = computePolicyMaps(context, policy);
    }
    validateMaps(context, maps, policy);
    const { edits, names } = editsForProject(context, maps);
    const changes: RenumberChange[] = [];
    for (const [old, next] of maps.board) if (old !== next) changes.push({ namespace: "board", old, new: next });
    for (const [moduleId, map] of maps.modules) {
      for (const [old, next] of map) if (old !== next) changes.push({ namespace: moduleId, old, new: next });
    }
    changes.sort((a, b) => (a.namespace === b.namespace ? naturalCompare(a.old, b.old) : a.namespace < b.namespace ? -1 : 1));

    const applied = options.apply === true && edits.length > 0;
    // Compile the renumbered sources in a temporary copy first, so an apply never leaves a project
    // that does not compile. `writeAll` still keeps its own all-or-none rollback.
    const after = edits.length === 0
      ? { project: before.project, advisory: before.advisory }
      : buildWithOverrides(options.root, edits);
    if (options.apply && edits.length > 0) {
      writeAll(options.root, edits);
      const built = hashOf(options.root);
      const errors = built.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      if (errors.length > 0) {
        const first = errors[0]!;
        fail(`the renumbered project has errors: ${first.code}: ${first.message}`);
      }
    }

    let check: { errors: number; warnings: number } | null = null;
    if (options.apply) {
      const result = checkProject(options.root);
      for (const diagnostic of result.diagnostics) {
        if (diagnostic.severity !== "error") continue;
        const where = diagnostic.location
          ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
          : "";
        console.error(`${where}${diagnostic.code}: ${diagnostic.message}`);
      }
      check = {
        errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
        warnings: result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
      };
    }

    report(
      {
        board: options.board,
        policy,
        applied: applied || (options.apply === true && edits.length === 0),
        changes,
        files: edits.map((edit) => edit.file).sort(),
        markdown: markdownHits(options.root, names),
        project_hash: { before: before.project, after: after.project },
        advisory_hash: { before: before.advisory, after: after.advisory },
        check,
      },
      options.json === true,
    );
    return check?.errors ? 1 : 0;
  } catch (error) {
    if (error instanceof RenumberError) {
      console.error(`renumber: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
