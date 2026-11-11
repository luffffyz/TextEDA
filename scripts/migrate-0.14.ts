#!/usr/bin/env bun
// Migration to language 0.14 / IR v0.19 (ADR-0069): one project root, explicit PCB ownership,
// root interconnects, and project-scoped views. The old descriptions no longer parse, so this
// migration reads their structure directly and refuses any fact it cannot determine.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { lex } from "@texteda/parser";

const TARGET_VERSION = "0.14.0";
const TARGET_FORMAT = "0.14";
const SCHEMATIC_SECTIONS = ["modules", "instances", "nets", "ports", "constraints", "bus"];
const PCB_SECTIONS = [
  "modules", "stackup", "outline", "place", "connect", "trace", "via", "zone", "keepout",
  "rules", "silk", "physical_only", "deviation",
];
const VIEW_SECTIONS = [
  "place", "field", "module", "module_port", "interconnect", "module_place", "junction", "wire", "label", "port", "text",
];
const SYSTEM_SECTIONS = ["boards", "nets"];
const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const NET_ID_RE = /^[A-Za-z0-9_+-]+$/;
const PORT_ID_RE = /^[A-Za-z0-9_+-]+$/;
const MODULE_INSTANCE_RE = /^M[0-9]+$/;
const UID_RE = /^ID[0-9a-hjkmnp-tv-z]{6}$/;

type Row = { cells: string[]; comments: string[]; line: number; raw: string };
type Section = { comments: string[]; rows: Row[] };
type Doc = {
  file: string;
  kind: string;
  id: string;
  version: string;
  intro: string[];
  scalars: Row[];
  sections: Map<string, Section>;
  trailing: string[];
};
type Net = { name: string; members: string[]; row: Row; comments: string[] };
type Board = {
  id: string;
  schPath: string;
  pcbPath: string;
  sch: Doc;
  pcb: Doc;
  nets: Map<string, Net>;
  ports: Map<string, { net: string; row: Row }>;
  modules: { id: string; uid?: string; moduleId: string; row: Row }[];
  modulePorts: Map<string, Set<string>>;
  netTargets: Map<string, string>;
};
type SystemNet = { name: string; endpoints: string[]; row: Row; comments: string[]; system: Doc };
type Endpoint = { board: Board; boardPort: string; boardNet: string; modulePort: string };

const problems: string[] = [];
const notes: string[] = [];
const fail = (message: string): void => { problems.push(message); };
const note = (message: string): void => { notes.push(message); };
const rel = (root: string, path: string): string => relative(root, path).replaceAll("\\", "/");

function entries(path: string, root: string): { path: string; name: string; isFile: boolean; isDirectory: boolean }[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true }).map((entry) => ({
      path: join(path, entry.name), name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(),
    }));
  } catch (error) {
    fail(`cannot read ${rel(root, path)}: ${String(error)}`);
    return [];
  }
}

function readDoc(root: string, path: string, expectedKind: string, knownSections: readonly string[]): Doc | undefined {
  const file = rel(root, path);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(`${file}: cannot read source: ${String(error)}`);
    return undefined;
  }
  const lines = lex(text);
  const significant = lines.filter((line) => !line.blank && !line.comment);
  const first = significant[0];
  const second = significant[1];
  if (!first || first.cells.length !== 2 || first.cells[0]!.text !== "version") {
    fail(`${file}: expected a 'version <language-version>' header`);
    return undefined;
  }
  if (!second || second.cells.length !== 2 || second.cells[0]!.text !== expectedKind) {
    fail(`${file}: expected a '${expectedKind} <id>' header`);
    return undefined;
  }
  const version = first.cells[1]!.text;
  const id = second.cells[1]!.text;
  const known = new Set(knownSections);
  const doc: Doc = { file, kind: expectedKind, id, version, intro: [], scalars: [], sections: new Map(), trailing: [] };
  let afterHeader = false;
  let headerCount = 0;
  let pending: string[] = [];
  let current: Section | undefined;
  for (const line of lines) {
    if (line.blank) continue;
    if (line.comment) {
      pending.push(line.text);
      continue;
    }
    if (!afterHeader) {
      headerCount += 1;
      if (headerCount === 2) {
        doc.intro = pending;
        pending = [];
        afterHeader = true;
      }
      continue;
    }
    const cells = line.cells.map((cell) => cell.text);
    if (cells.length === 1 && known.has(cells[0]!)) {
      const name = cells[0]!;
      let section = doc.sections.get(name);
      if (!section) {
        section = { comments: [], rows: [] };
        doc.sections.set(name, section);
      }
      section.comments.push(...pending);
      pending = [];
      current = section;
      continue;
    }
    const row: Row = { cells, comments: pending, line: line.number, raw: line.text };
    pending = [];
    if (current) current.rows.push(row);
    else doc.scalars.push(row);
  }
  doc.trailing = pending;
  if (doc.id !== basename(path).replace(/\.view\.teda$|\.teda$/, "")) {
    fail(`${file}: header id '${doc.id}' does not match the file name`);
  }
  if (doc.version === "") fail(`${file}: missing language version`);
  return doc;
}

function linesOfRows(rows: readonly Row[], transform: (row: Row) => string[] = (row) => row.cells, preserveRaw = false): string[] {
  const result: string[] = [];
  for (const row of rows) {
    result.push(...row.comments);
    result.push(preserveRaw ? row.raw : `  ${transform(row).join("  ")}`.trimEnd());
  }
  return result;
}

function renderDoc(doc: Doc, kind: string, id: string, version: string, sectionOrder: readonly string[],
  overrideRows: Map<string, Row[]> = new Map(), scalarRows?: Row[]): string {
  const lines: string[] = [...doc.intro, `version ${version}`, `${kind} ${id}`];
  const scalars = scalarRows ?? doc.scalars;
  if (scalars.length > 0) {
    lines.push("");
    lines.push(...linesOfRows(scalars));
  }
  for (const name of sectionOrder) {
    const section = doc.sections.get(name);
    const rows = overrideRows.get(name) ?? section?.rows ?? [];
    if (!section && !overrideRows.has(name)) continue;
    const comments = section?.comments ?? [];
    lines.push("", ...comments, name);
    lines.push(...linesOfRows(rows));
  }
  if (doc.trailing.length > 0) lines.push("", ...doc.trailing);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function netRows(doc: Doc, path: string): Map<string, Net> {
  const result = new Map<string, Net>();
  const section = doc.sections.get("nets");
  if (!section) return result;
  let active: Net | undefined;
  for (const row of section.rows) {
    const first = row.cells[0] ?? "";
    const name = first === ":" ? "" : first.endsWith(":") ? first.slice(0, -1) : first;
    const memberStart = first === ":" ? 1 : row.cells[1] === ":" ? 2 : 1;
    const members = row.cells.slice(memberStart);
    if (name === "") {
      if (!active) {
        fail(`${path}:${row.line}: net continuation appears before a named net`);
        continue;
      }
      active.members.push(...members);
      active.comments.push(...row.comments);
      continue;
    }
    if (!NET_ID_RE.test(name)) {
      fail(`${path}:${row.line}: invalid net id '${name}'`);
      active = undefined;
      continue;
    }
    if (result.has(name)) {
      fail(`${path}:${row.line}: duplicate net '${name}'`);
      active = result.get(name);
      continue;
    }
    active = { name, members, row, comments: [...row.comments] };
    result.set(name, active);
  }
  return result;
}

function parsePorts(doc: Doc): Map<string, { net: string; row: Row }> {
  const result = new Map<string, { net: string; row: Row }>();
  for (const row of doc.sections.get("ports")?.rows ?? []) {
    if (row.cells.length !== 2) {
      fail(`${doc.file}:${row.line}: a port row must be '<port_id> <net_id>'`);
      continue;
    }
    const [id, net] = row.cells as [string, string];
    if (!PORT_ID_RE.test(id) || !NET_ID_RE.test(net)) {
      fail(`${doc.file}:${row.line}: invalid port id or net '${id} ${net}'`);
      continue;
    }
    if (result.has(id)) fail(`${doc.file}:${row.line}: duplicate port '${id}'`);
    else result.set(id, { net, row });
  }
  return result;
}

function parseModulePorts(root: string, moduleId: string): Set<string> {
  const path = join(root, "design", "modules", `${moduleId}.teda`);
  if (!SLUG_RE.test(moduleId)) fail(`${path}: invalid module id '${moduleId}'`);
  const doc = readDoc(root, path, "module", ["instances", "nets", "ports", "constraints"]);
  const ports = new Set<string>();
  if (!doc) return ports;
  if (doc.id !== moduleId) fail(`${doc.file}: module id '${doc.id}' does not match referenced module '${moduleId}'`);
  for (const row of doc.sections.get("ports")?.rows ?? []) {
    if (row.cells.length !== 2) {
      fail(`${doc.file}:${row.line}: a module port row must be '<port_id> <net_id>'`);
      continue;
    }
    const port = row.cells[0]!;
    const net = row.cells[1]!;
    if (!PORT_ID_RE.test(port) || !NET_ID_RE.test(net)) {
      fail(`${doc.file}:${row.line}: invalid module port or net '${port} ${net}'`);
      continue;
    }
    if (ports.has(port)) fail(`${doc.file}:${row.line}: duplicate module port '${port}'`);
    ports.add(port);
  }
  return ports;
}

function parseModuleRows(doc: Doc): Board["modules"] {
  const rows: Board["modules"] = [];
  const section = doc.sections.get("modules");
  if (!section) {
    fail(`${doc.file}: missing required legacy 'modules' section`);
    return rows;
  }
  for (const row of section.rows) {
    if (row.cells.length !== 2 && row.cells.length !== 3) {
      fail(`${doc.file}:${row.line}: module row must be '<module_instance_id> [UID] <module_id>'`);
      continue;
    }
    const id = row.cells[0]!;
    const uid = row.cells.length === 3 ? row.cells[1]! : undefined;
    const moduleId = row.cells[row.cells.length - 1]!;
    if (!MODULE_INSTANCE_RE.test(id) || !SLUG_RE.test(moduleId) || (uid !== undefined && !UID_RE.test(uid))) {
      fail(`${doc.file}:${row.line}: invalid module instance row '${row.cells.join(" ")}'`);
      continue;
    }
    rows.push({ id, ...(uid === undefined ? {} : { uid }), moduleId, row });
  }
  return rows;
}

function rewriteProjectFormat(text: string): { text?: string; error?: string } {
  const lines = text.split("\n");
  let table = "";
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    const header = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(trimmed);
    if (header) table = header[1]!;
    if (table !== "project") continue;
    if (/^\s*format\s*=/.test(lines[index]!)) found.push(index);
  }
  if (found.length !== 1) return { error: `project.toml: expected exactly one [project].format key, found ${found.length}` };
  const index = found[0]!;
  const match = /^(\s*format\s*=\s*)(["'][^"']*["'])(\s*(?:#.*)?)$/.exec(lines[index]!);
  if (!match) return { error: `project.toml:${index + 1}: cannot safely rewrite format; expected a quoted value` };
  lines[index] = `${match[1]}"${TARGET_FORMAT}"${match[3]}`;
  return { text: lines.join("\n") };
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function slugPart(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function main(): number {
  const arg = process.argv[2];
  if (!arg || process.argv.length > 3) {
    console.error("usage: bun run migrate:0.14 <project dir>");
    return 2;
  }
  const root = resolve(arg);
  const projectFile = join(root, "project.toml");
  if (!existsSync(projectFile) || !existsSync(join(root, "design"))) {
    console.error(`${root}: not a TextEDA project (expected project.toml and design/)`);
    return 1;
  }

  const schematicDir = join(root, "design", "sch");
  const pcbDir = join(root, "design", "pcb");
  const systemDir = join(root, "design", "system");
  const viewDir = join(root, "views");
  const schematicEntries = entries(schematicDir, root);
  const pcbEntries = entries(pcbDir, root);
  const systemEntries = entries(systemDir, root);
  const boardFiles = schematicEntries.filter((entry) => entry.isFile && entry.name.endsWith(".teda") && entry.name !== "main.teda");
  const pcbFiles = pcbEntries.filter((entry) => entry.isFile && entry.name.endsWith(".teda"));
  const systemFiles = systemEntries.filter((entry) => entry.isFile && entry.name.endsWith(".teda"));

  let projectText = "";
  try { projectText = readFileSync(projectFile, "utf8"); }
  catch (error) { fail(`project.toml: cannot read source: ${String(error)}`); }
  let projectTable = "";
  const projectFormats: string[] = [];
  for (const line of projectText.split("\n")) {
    const trimmed = line.trim();
    const table = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(trimmed);
    if (table) projectTable = table[1]!;
    if (projectTable !== "project") continue;
    const format = /^\s*format\s*=\s*[\"']([^\"']+)[\"']\s*(?:#.*)?$/.exec(line);
    if (format) projectFormats.push(format[1]!);
  }
  const projectFormat = projectFormats.length === 1 ? projectFormats[0] : undefined;
  if (projectFormats.length !== 1) fail(`project.toml: expected exactly one [project].format value, found ${projectFormats.length}`);
  if (projectFormat === TARGET_FORMAT && boardFiles.length > 0) {
    fail("project.toml already declares format 0.14 while board-local schematics remain; resolve this partial migration manually before retrying");
  }
  if (boardFiles.length === 0) {
    if (projectFormat === TARGET_FORMAT && existsSync(join(schematicDir, "main.teda")) && systemFiles.length === 0) {
      console.log("Project already uses the 0.14 project-root layout; nothing to migrate.");
      return problems.length === 0 ? 0 : 1;
    }
    fail("no legacy board schematics found in design/sch; migration requires the old board roots to determine project logic and PCB ownership");
  }
  if (existsSync(join(schematicDir, "main.teda"))) fail("design/sch/main.teda already exists; refusing to overwrite a possible project root");
  if (projectFormat && compareVersions(projectFormat, TARGET_FORMAT) >= 0) fail(`project.toml: format ${projectFormat} is not older than target ${TARGET_FORMAT}`);

  const boardById = new Map<string, Board>();
  const pcbIdSet = new Set(pcbFiles.map((entry) => entry.name.slice(0, -5)));
  const pcbDocs = new Map<string, Doc>();
  for (const entry of pcbFiles) {
    const id = entry.name.slice(0, -5);
    const doc = readDoc(root, entry.path, "pcb", PCB_SECTIONS);
    if (!doc) continue;
    if (doc.id !== id) fail(`${doc.file}: PCB id '${doc.id}' does not match file id '${id}'`);
    if (doc.sections.has("modules")) fail(`${doc.file}: already has a 'modules' section; ownership cannot be reconstructed safely`);
    pcbDocs.set(id, doc);
  }

  let globalModuleUid = new Map<string, string>();
  const globalModuleId = new Map<string, string>();
  for (const entry of boardFiles) {
    const id = entry.name.slice(0, -5);
    const sch = readDoc(root, entry.path, "schematic", SCHEMATIC_SECTIONS);
    if (!sch) continue;
    if (sch.id !== id) fail(`${sch.file}: schematic id '${sch.id}' does not match file id '${id}'`);
    if (sch.sections.has("instances")) fail(`${sch.file}: direct board-level 'instances' cannot be assigned to a module automatically; move these components into an authored module before migrating`);
    if (sch.sections.has("bus")) fail(`${sch.file}: legacy 'bus' facts have no deterministic conversion in the project-root model; convert or remove them before migrating`);
    const pcbPath = join(pcbDir, `${id}.teda`);
    const pcb = pcbDocs.get(id);
    if (!pcb || !existsSync(pcbPath)) fail(`${sch.file}: no matching design/pcb/${id}.teda exists; assign this board's modules to a PCB explicitly before migrating`);
    const modules = parseModuleRows(sch);
    for (const item of modules) {
      const other = globalModuleId.get(item.id);
      if (other) fail(`${sch.file}:${item.row.line}: module instance id '${item.id}' also appears in ${other}; rename it before migrating`);
      else globalModuleId.set(item.id, sch.file);
      if (item.uid) {
        const uidOwner = globalModuleUid.get(item.uid);
        if (uidOwner) fail(`${sch.file}:${item.row.line}: module UID '${item.uid}' also appears in ${uidOwner}; assign a project-unique UID before migrating`);
        else globalModuleUid.set(item.uid, sch.file);
      }
    }
    const modulePorts = new Map<string, Set<string>>();
    for (const module of modules) modulePorts.set(module.id, parseModulePorts(root, module.moduleId));
    const ports = parsePorts(sch);
    const board: Board = {
      id, schPath: entry.path, pcbPath, sch, pcb: pcb ?? ({} as Doc),
      nets: netRows(sch, sch.file), ports, modules, modulePorts,
      netTargets: new Map(),
    };
    for (const netName of board.nets.keys()) board.netTargets.set(netName, netName);
    boardById.set(id, board);
  }
  for (const id of pcbIdSet) {
    if (!boardById.has(id)) fail(`${rel(root, join(pcbDir, `${id}.teda`))}: orphan PCB has no matching legacy schematic; its module ownership is not determined`);
  }
  if (boardById.size !== boardFiles.length) fail("one or more legacy schematic files could not be read; see the diagnostics above");

  // Validate every old board net is already a module-port net. The target root has no direct component instances.
  const modulePortOwner = new Map<string, string>();
  for (const board of boardById.values()) {
    for (const net of board.nets.values()) {
      if (net.members.length === 0) fail(`${board.sch.file}:${net.row.line}: net '${net.name}' has no members`);
      for (const member of net.members) {
        const parts = member.split(".");
        if (parts.length !== 2 || !board.modulePorts.has(parts[0]!)) {
          fail(`${board.sch.file}:${net.row.line}: member '${member}' is not a module port; the new root can contain module ports only, so move direct component connectivity into a module`);
          continue;
        }
        const moduleId = parts[0]!;
        const portId = parts[1]!;
        if (!board.modulePorts.get(moduleId)!.has(portId)) {
          fail(`${board.sch.file}:${net.row.line}: '${member}' is not a declared port of module instance ${moduleId}`);
          continue;
        }
        const prior = modulePortOwner.get(`${board.id}|${member}`);
        if (prior) fail(`${board.sch.file}:${net.row.line}: module port '${member}' appears on both nets '${prior}' and '${net.name}'`);
        else modulePortOwner.set(`${board.id}|${member}`, net.name);
      }
    }
    for (const [portId, port] of board.ports) {
      if (!board.nets.has(port.net)) fail(`${board.sch.file}:${port.row.line}: board port '${portId}' references unknown net '${port.net}'`);
    }
  }

  const systems: Doc[] = [];
  for (const entry of systemFiles) {
    const doc = readDoc(root, entry.path, "system", SYSTEM_SECTIONS);
    if (!doc) continue;
    if (doc.id !== entry.name.slice(0, -5)) fail(`${doc.file}: system id '${doc.id}' does not match file id`);
    systems.push(doc);
  }
  const allSystemNets: SystemNet[] = [];
  const systemNetNames = new Map<string, string>();
  for (const system of systems) {
    const systemBoards = new Set<string>();
    for (const row of system.sections.get("boards")?.rows ?? []) {
      if (row.cells.length !== 1) {
        fail(`${system.file}:${row.line}: a system board row must contain exactly one board id`);
        continue;
      }
      const boardId = row.cells[0]!;
      if (!boardById.has(boardId)) fail(`${system.file}:${row.line}: system references unknown board '${boardId}'`);
      if (systemBoards.has(boardId)) fail(`${system.file}:${row.line}: duplicate system board '${boardId}'`);
      systemBoards.add(boardId);
    }
    let active: SystemNet | undefined;
    for (const row of system.sections.get("nets")?.rows ?? []) {
      const first = row.cells[0] ?? "";
      const name = first === ":" ? "" : first.endsWith(":") ? first.slice(0, -1) : first;
      const memberStart = first === ":" ? 1 : row.cells[1] === ":" ? 2 : 1;
      const endpoints = row.cells.slice(memberStart);
      if (name === "") {
        if (!active) {
          fail(`${system.file}:${row.line}: continuation row appears before a named system net`);
          continue;
        }
        active.endpoints.push(...endpoints);
        active.comments.push(...row.comments);
        continue;
      }
      if (!NET_ID_RE.test(name)) {
        fail(`${system.file}:${row.line}: invalid system net id '${name}'`);
        active = undefined;
        continue;
      }
      const previous = systemNetNames.get(name);
      if (previous) fail(`${system.file}:${row.line}: system net '${name}' also appears in ${previous}; root net identity would be ambiguous`);
      else systemNetNames.set(name, system.file);
      active = { name, endpoints, row, comments: [...row.comments], system };
      allSystemNets.push(active);
    }
    for (const net of allSystemNets.filter((item) => item.system === system)) {
      if (net.endpoints.length !== 2) fail(`${system.file}:${net.row.line}: system net '${net.name}' has ${net.endpoints.length} endpoints; migration requires exactly two endpoints to create an unambiguous interconnect`);
      const parsedBoards = net.endpoints.map((endpoint) => endpoint.split(".")[0]!);
      for (const boardId of parsedBoards) {
        if (!systemBoards.has(boardId)) fail(`${system.file}:${net.row.line}: endpoint board '${boardId}' is not listed in this system's 'boards' section`);
      }
      if (parsedBoards.length === 2 && parsedBoards[0] === parsedBoards[1]) fail(`${system.file}:${net.row.line}: endpoints of system net '${net.name}' are on the same board; a cross-PCB interconnect cannot be inferred`);
    }
  }

  const resolveEndpoint = (systemNet: SystemNet, text: string): Endpoint | undefined => {
    const parts = text.split(".");
    if (parts.length !== 2) {
      fail(`${systemNet.system.file}:${systemNet.row.line}: endpoint '${text}' must be '<board_id>.<port_id>'`);
      return undefined;
    }
    const board = boardById.get(parts[0]!);
    if (!board) return undefined;
    const boardPort = board.ports.get(parts[1]!);
    if (!boardPort) {
      fail(`${systemNet.system.file}:${systemNet.row.line}: board '${board.id}' has no port '${parts[1]}'`);
      return undefined;
    }
    const net = board.nets.get(boardPort.net);
    if (!net) return undefined;
    const candidates = net.members.filter((member) => {
      const moduleId = member.split(".")[0]!;
      return board.modulePorts.has(moduleId);
    });
    if (candidates.length !== 1) {
      fail(`${systemNet.system.file}:${systemNet.row.line}: ${text} resolves to ${candidates.length} module-port endpoints on net '${net.name}'; make the board port resolve to exactly one module port before migrating`);
      return undefined;
    }
    const modulePort = candidates[0]!;
    const moduleInstance = modulePort.slice(0, modulePort.indexOf("."));
    if (!board.modulePorts.get(moduleInstance)?.has(modulePort.slice(modulePort.indexOf(".") + 1))) return undefined;
    return { board, boardPort: parts[1]!, boardNet: net.name, modulePort };
  };

  const disjoint = new Map<string, string>();
  const rootOf = (key: string): string => {
    const parent = disjoint.get(key);
    if (!parent) { disjoint.set(key, key); return key; }
    if (parent === key) return key;
    const rootKey = rootOf(parent);
    disjoint.set(key, rootKey);
    return rootKey;
  };
  const union = (left: string, right: string): void => {
    const a = rootOf(left), b = rootOf(right);
    if (a !== b) disjoint.set(b, a);
  };
  const interconnectRows: Row[] = [];
  const interconnectIdOwner = new Map<string, string>();
  for (const systemNet of allSystemNets) {
    if (systemNet.endpoints.length !== 2) continue;
    const endpoints = systemNet.endpoints.map((text) => resolveEndpoint(systemNet, text));
    if (!endpoints[0] || !endpoints[1]) continue;
    const [from, to] = endpoints as [Endpoint, Endpoint];
    const fromKey = `${from.board.id}|${from.boardNet}`;
    const toKey = `${to.board.id}|${to.boardNet}`;
    union(fromKey, toKey);
    for (const endpoint of [from, to]) {
      const existing = endpoint.board.netTargets.get(endpoint.boardNet)!;
      if (existing !== endpoint.boardNet && existing !== systemNet.name) {
        fail(`${systemNet.system.file}:${systemNet.row.line}: board net '${endpoint.board.id}.${endpoint.boardNet}' is assigned to both system nets '${existing}' and '${systemNet.name}'`);
      }
      endpoint.board.netTargets.set(endpoint.boardNet, systemNet.name);
    }
    const suffix = slugPart(systemNet.name);
    const id = `ic-${systemNet.system.id}-${suffix}`;
    if (!/^[a-z][a-z0-9-]*$/.test(id) || suffix === "") {
      fail(`${systemNet.system.file}:${systemNet.row.line}: cannot derive a valid interconnect id from system '${systemNet.system.id}' and net '${systemNet.name}'`);
      continue;
    }
    const idPrior = interconnectIdOwner.get(id);
    if (idPrior) fail(`${systemNet.system.file}:${systemNet.row.line}: generated interconnect id '${id}' collides with ${idPrior}; rename the source system/net identity before migrating`);
    else interconnectIdOwner.set(id, `${systemNet.system.file}:${systemNet.row.line}`);
    const row: Row = { cells: [id, from.modulePort, to.modulePort], comments: systemNet.comments, line: systemNet.row.line, raw: "" };
    interconnectRows.push(row);
    note(`${systemNet.system.file}:${systemNet.row.line}: generated interconnect ${id} from ${from.modulePort} to ${to.modulePort}; no connector-pin mapping is emitted because the old source has none`);
  }

  const targetSources = new Map<string, string[]>();
  const targetMembers = new Map<string, string[]>();
  const targetComments = new Map<string, string[]>();
  const rootNetOrder: string[] = [];
  for (const board of boardById.values()) {
    for (const net of board.nets.values()) {
      const target = board.netTargets.get(net.name) ?? net.name;
      const sourceKey = `${board.id}|${net.name}`;
      const sources = targetSources.get(target) ?? [];
      sources.push(sourceKey);
      targetSources.set(target, sources);
      if (!targetMembers.has(target)) {
        targetMembers.set(target, []);
        targetComments.set(target, []);
        rootNetOrder.push(target);
      }
      targetMembers.get(target)!.push(...net.members);
      targetComments.get(target)!.push(...net.comments);
    }
  }
  for (const [name, sources] of targetSources) {
    if (sources.length > 1) {
      const roots = new Set(sources.map((source) => rootOf(source)));
      if (roots.size !== 1) fail(`project net '${name}' would merge unrelated board-local nets ${sources.join(", ")}; add explicit system connectivity or rename one net before migrating`);
    }
    const members = targetMembers.get(name)!;
    if (new Set(members).size !== members.length) fail(`project net '${name}' would contain a duplicate module-port member; resolve the source net overlap before migrating`);
  }

  const rootPorts = new Map<string, string>();
  const portRows: Row[] = [];
  for (const board of boardById.values()) {
    for (const [id, port] of board.ports) {
      const net = board.netTargets.get(port.net) ?? port.net;
      const previous = rootPorts.get(id);
      if (previous !== undefined) {
        if (previous !== net) {
          fail(`${board.sch.file}:${port.row.line}: project port '${id}' maps to both '${previous}' and '${net}'; rename one board port before migrating`);
        } else {
          fail(`${board.sch.file}:${port.row.line}: project port '${id}' is declared more than once; rename the board port before migrating`);
        }
      } else {
        rootPorts.set(id, net);
        portRows.push({ cells: [id, net], comments: port.row.comments, line: port.row.line, raw: port.row.raw });
      }
    }
  }

  const moduleRows: Row[] = [];
  const constraintRows: Row[] = [];
  for (const board of boardById.values()) {
    for (const module of board.modules) {
      moduleRows.push({ cells: [module.id, ...(module.uid ? [module.uid] : []), module.moduleId], comments: module.row.comments, line: module.row.line, raw: module.row.raw });
    }
    for (const row of board.sch.sections.get("constraints")?.rows ?? []) {
      if (row.cells.length < 2) {
        fail(`${board.sch.file}:${row.line}: malformed constraint row`);
        continue;
      }
      const cells = [...row.cells];
      const subjectIndexes = cells[0] === "diff" || cells[0] === "skew" ? [1, 2] : [1];
      for (const index of subjectIndexes) {
        const mapped = board.netTargets.get(cells[index]!);
        if (mapped) cells[index] = mapped;
      }
      constraintRows.push({ ...row, cells });
    }
  }

  const rootNetRows: Row[] = rootNetOrder.map((name) => ({
    cells: [`${name}:`, ...(targetMembers.get(name) ?? [])],
    comments: targetComments.get(name) ?? [],
    line: 0,
    raw: "",
  }));
  const mainDoc: Doc = {
    file: "design/sch/main.teda", kind: "schematic", id: "main", version: TARGET_VERSION,
    intro: [], scalars: [], sections: new Map(), trailing: [],
  };
  mainDoc.sections.set("modules", { comments: [], rows: moduleRows });
  mainDoc.sections.set("nets", { comments: [], rows: rootNetRows });
  if (portRows.length > 0) mainDoc.sections.set("ports", { comments: [], rows: portRows });
  if (constraintRows.length > 0) mainDoc.sections.set("constraints", { comments: [], rows: constraintRows });
  if (interconnectRows.length > 0) mainDoc.sections.set("interconnects", { comments: [], rows: interconnectRows });
  const mainText = renderDoc(mainDoc, "schematic", "main", TARGET_VERSION,
    ["modules", "nets", "ports", "constraints", "interconnects"]);

  const rewrittenFormat = rewriteProjectFormat(projectText);
  if (rewrittenFormat.error) fail(rewrittenFormat.error);

  // Move old board pages to the flat project namespace. Module drawings and templates are already project-scoped.
  const legacyViews: { source: string; dest: string; doc: Doc; board: Board }[] = [];
  const viewDirs = entries(viewDir, root).filter((entry) => entry.isDirectory && entry.name !== "modules" && entry.name !== "templates");
  const flatViewIds = new Set(entries(viewDir, root)
    .filter((entry) => entry.isFile && entry.name.endsWith(".view.teda"))
    .map((entry) => entry.name.slice(0, -".view.teda".length)));
  for (const dir of viewDirs) {
    const pages = entries(dir.path, root).filter((entry) => entry.name.endsWith(".view.teda"));
    if (pages.length === 0) continue;
    const board = boardById.get(dir.name);
    if (!board) {
      fail(`${rel(root, dir.path)}: board-scoped view directory has no matching legacy schematic`);
      continue;
    }
    for (const page of pages) {
      if (!page.isFile) {
        fail(`${rel(root, page.path)}: expected a regular .view.teda file`);
        continue;
      }
      const pageId = page.name.slice(0, -".view.teda".length);
      if (flatViewIds.has(pageId)) {
        fail(`${rel(root, page.path)}: page id '${pageId}' already exists in the project-wide views/ namespace; rename the page before migrating`);
        continue;
      }
      const doc = readDoc(root, page.path, "view", VIEW_SECTIONS);
      if (!doc) continue;
      if (doc.id !== pageId) fail(`${doc.file}: view id '${doc.id}' does not match file id '${pageId}'`);
      flatViewIds.add(pageId);
      legacyViews.push({ source: page.path, dest: join(viewDir, `${pageId}.view.teda`), doc, board });
    }
  }

  const writes = new Map<string, string>();
  writes.set(projectFile, rewrittenFormat.text ?? "");
  writes.set(join(schematicDir, "main.teda"), mainText);
  // Module definitions move under the schematic tree (ADR-0070). The legacy directory is the
  // migration input; the migrated output has no design/modules/.
  const legacyModuleDir = join(root, "design", "modules");
  const legacyModules = entries(legacyModuleDir, root).filter((entry) => entry.isFile);
  for (const module of legacyModules) {
    writes.set(join(schematicDir, "modules", module.name), readFileSync(module.path, "utf8"));
  }
  for (const board of boardById.values()) {
    if (!board.pcb || !board.pcb.file) continue;
    const rows = new Map<string, Row[]>();
    for (const name of PCB_SECTIONS) {
      const section = board.pcb.sections.get(name);
      if (section) rows.set(name, [...section.rows]);
    }
    rows.set("modules", board.modules.map((module) => ({
      cells: [module.id], comments: module.row.comments, line: module.row.line, raw: module.row.raw,
    })));
    const netMap = board.netTargets;
    for (const section of ["trace", "via", "zone"] as const) {
      if (!rows.has(section)) continue;
      rows.set(section, rows.get(section)!.map((row) => ({
        ...row, cells: [netMap.get(row.cells[0]!) ?? row.cells[0]!, ...row.cells.slice(1)],
      })));
    }
    if (rows.has("rules")) rows.set("rules", rows.get("rules")!.map((row) => {
      const cells = [...row.cells];
      if (cells[0] === "net") cells[1] = netMap.get(cells[1]!) ?? cells[1]!;
      if (cells[0] === "diff" || cells[0] === "match") {
        cells[1] = netMap.get(cells[1]!) ?? cells[1]!;
        cells[2] = netMap.get(cells[2]!) ?? cells[2]!;
      }
      return { ...row, cells };
    }));
    if (rows.has("physical_only")) rows.set("physical_only", rows.get("physical_only")!.map((row) => {
      const cells = [...row.cells];
      if (cells[1] === "stitching" && cells.length > 3) cells[3] = netMap.get(cells[3]!) ?? cells[3]!;
      return { ...row, cells };
    }));
    if (rows.has("deviation")) rows.set("deviation", rows.get("deviation")!.map((row) => {
      const cells = [...row.cells];
      if (cells[0] === "net_tie") {
        cells[1] = netMap.get(cells[1]!) ?? cells[1]!;
        cells[2] = netMap.get(cells[2]!) ?? cells[2]!;
      } else if (cells[0] === "split_ground") {
        cells[1] = netMap.get(cells[1]!) ?? cells[1]!;
      }
      return { ...row, cells };
    }));
    const text = renderDoc(board.pcb, "pcb", board.id, TARGET_VERSION, PCB_SECTIONS, rows);
    writes.set(board.pcbPath, text);
  }
  for (const page of legacyViews) {
    const mapped = new Map<string, Row[]>();
    for (const name of VIEW_SECTIONS) {
      const rows = page.doc.sections.get(name)?.rows ?? [];
      if (name === "wire" || name === "label") {
        mapped.set(name, rows.map((row) => ({
          ...row,
          cells: [page.board.netTargets.get(row.cells[0]!) ?? row.cells[0]!, ...row.cells.slice(1)],
        })));
      }
    }
    writes.set(page.dest, renderDoc(page.doc, "view", page.doc.id, TARGET_VERSION, VIEW_SECTIONS, mapped));
  }

  if (problems.length > 0) {
    console.error(`Migration refused: ${problems.length} unresolved prerequisite${problems.length === 1 ? "" : "s"}. No project files were changed.`);
    for (const problem of problems) console.error(`  x ${problem}`);
    return 1;
  }
  for (const item of notes) console.log(`  - ${item}`);

  const removals = [
    ...boardFiles.map((entry) => entry.path),
    ...systemFiles.map((entry) => entry.path),
    ...legacyViews.map((page) => page.source),
    ...legacyModules.map((entry) => entry.path),
  ];
  const removableDirs = [systemDir, ...viewDirs.map((entry) => entry.path), legacyModuleDir];
  const stage = mkdtempSync(join(root, ".migrate-0.14-"));
  const stagedWrites: { dest: string; staged: string }[] = [];
  const targetBackups: { dest: string; backup: string }[] = [];
  const sourceBackups: { source: string; backup: string }[] = [];
  const installed: string[] = [];
  const createdDirs: string[] = [];
  const removedDirs: string[] = [];
  try {
    let index = 0;
    for (const [dest, text] of writes) {
      const staged = join(stage, `write-${index++}`);
      writeFileSync(staged, text, "utf8");
      stagedWrites.push({ dest, staged });
    }
    const ensureDirectory = (path: string): void => {
      if (existsSync(path)) return;
      const parent = dirname(path);
      if (!existsSync(parent)) ensureDirectory(parent);
      mkdirSync(path);
      createdDirs.push(path);
    };
    for (const item of stagedWrites) {
      ensureDirectory(dirname(item.dest));
      if (existsSync(item.dest)) {
        const backup = join(stage, `target-${targetBackups.length}`);
        renameSync(item.dest, backup);
        targetBackups.push({ dest: item.dest, backup });
      }
      renameSync(item.staged, item.dest);
      installed.push(item.dest);
    }
    for (const source of removals) {
      if (!existsSync(source)) continue;
      const backup = join(stage, `source-${sourceBackups.length}`);
      renameSync(source, backup);
      sourceBackups.push({ source, backup });
    }
    for (const dir of removableDirs) {
      if (!existsSync(dir)) continue;
      try { if (readdirSync(dir).length === 0) { rmdirSync(dir); removedDirs.push(dir); } }
      catch { /* A non-empty legacy directory may contain unrelated user files; leave it intact. */ }
    }
  } catch (error) {
    console.error(`Migration failed during commit: ${String(error)}; restoring original project files.`);
    for (const path of [...removedDirs, ...createdDirs].reverse()) {
      try { if (removedDirs.includes(path)) mkdirSync(path, { recursive: true }); else rmdirSync(path); } catch { /* rollback continues */ }
    }
    for (const path of installed.reverse()) { try { unlinkSync(path); } catch { /* rollback continues */ } }
    for (const item of targetBackups.reverse()) { try { renameSync(item.backup, item.dest); } catch { /* rollback continues */ } }
    for (const item of sourceBackups.reverse()) { try { renameSync(item.backup, item.source); } catch { /* rollback continues */ } }
    try { rmSync(stage, { recursive: true, force: true }); } catch { /* best effort after rollback */ }
    return 1;
  }
  try { rmSync(stage, { recursive: true, force: true }); }
  catch (error) { console.error(`Migration completed, but temporary backup cleanup failed at ${stage}: ${String(error)}`); }
  console.log(`Migrated ${boardById.size} board schematic${boardById.size === 1 ? "" : "s"} to design/sch/main.teda, added explicit PCB ownership, and moved ${legacyViews.length} view page${legacyViews.length === 1 ? "" : "s"} to project scope.`);
  console.log(`Project language format is now ${TARGET_FORMAT}; schematic, PCB, and migrated view files declare ${TARGET_VERSION}.`);
  return 0;
}

process.exit(main());
