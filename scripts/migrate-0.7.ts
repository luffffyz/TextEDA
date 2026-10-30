#!/usr/bin/env bun
// Migration 0.6 -> 0.7 (ADR-0012): one flat schematic per board, the drawing partitioned in print pages.
//
// Usage:
//   bun run migrate:0.7 <project dir>
//
// The script works on the text, not on the IR: a 0.6 file no longer parses (the `page` type and the
// `pages` section are gone), so it reads the old shape with its own reader and writes the new shape,
// which the current formatter then canonicalizes.
//
// What it does, per board with a `pages` section:
//   1. merges the board root and the page files into one flat `schematic` file (version 0.7);
//   2. deletes the page files;
//   3. rewrites the print pages (`*.view.teda`): the page's net names become the board's net names;
//   4. rewrites the pcb description: the instance ids and net names lose their page prefix.
//
// What it refuses to do: choose a name. Two pages that use the same refdes, or the same net name,
// are reported and the board is left untouched -- renaming is an authoring decision (ADR-0012
// decision 2). The same goes for the print pages' port rows: a page port has no board-level
// counterpart in general, so the script reports it instead of inventing one.
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatPcb, formatSchematic, formatView, lex } from "@texteda/parser";

const SCHEMATIC_SECTIONS = ["instances", "nets", "ports", "pages", "constraints"];
const VIEW_SECTIONS = ["place", "wire", "label", "port", "text"];
const PCB_SECTIONS = [
  "stackup",
  "outline",
  "place",
  "connect",
  "trace",
  "via",
  "zone",
  "keepout",
  "rules",
  "silk",
  "physical_only",
  "deviation",
];

/** One table row: the comment lines above it, its cells, and the line it came from. */
interface Row {
  comments: string[];
  cells: string[];
  line: number;
}

/** One section: the comments above its header, the header cells, and its rows. */
interface Section {
  comments: string[];
  header: string[];
  rows: Row[];
}

/** A parsed description file. */
interface Doc {
  version: string;
  /** The type line's first cell: `schematic`, `page`, `view`, `pcb`. */
  type: string;
  /** The type line's second cell: the board id, the page id, the print page id. */
  id: string;
  /** The comments above the first section. */
  leading: string[];
  sections: Map<string, Section>;
}

/** One page of the old model. */
interface PageData {
  /** The page instance id (`P1`). */
  instance: string;
  /** The page id (`power`). */
  page: string;
  doc: Doc;
  /** The page's port id -> the page's net name. */
  ports: Map<string, string>;
  /** The page's nets: name and members. */
  nets: { name: string; members: string[] }[];
}

const problems: string[] = [];
const notes: string[] = [];

function fail(message: string): void {
  problems.push(message);
  console.error(`  x ${message}`);
}

function note(message: string): void {
  notes.push(message);
  console.log(`  - ${message}`);
}

/** Read the sections of a description file. Only the shape is read; no meaning is interpreted. */
function readDoc(text: string): Doc {
  const lines = lex(text);
  const doc: Doc = {
    version: "",
    type: "",
    id: "",
    leading: [],
    sections: new Map(),
  };
  let pending: string[] = [];
  let current: Section | null = null;
  const known = new Set([...SCHEMATIC_SECTIONS, ...VIEW_SECTIONS, ...PCB_SECTIONS]);
  for (const line of lines) {
    if (line.blank) continue;
    if (line.comment) {
      pending.push(line.text);
      continue;
    }
    const cells = line.cells.map((cell) => cell.text);
    if (cells[0] === "version" && doc.version === "" && !current) {
      doc.version = cells[1] ?? "";
      pending = [];
      continue;
    }
    if (doc.type === "" && !current) {
      doc.type = cells[0] ?? "";
      doc.id = cells[1] ?? "";
      pending = [];
      continue;
    }
    if (cells.length === 1 && known.has(cells[0]!)) {
      current = { comments: pending, header: cells, rows: [] };
      doc.sections.set(cells[0]!, current);
      pending = [];
      continue;
    }
    if (!current) {
      doc.leading.push(...pending);
      pending = [];
      continue;
    }
    current.rows.push({ comments: pending, cells, line: line.number });
    pending = [];
  }
  return doc;
}

/** The rows of a section, or an empty array. */
function rowsOf(doc: Doc, name: string): Row[] {
  return doc.sections.get(name)?.rows ?? [];
}

/** A net row's name and members: `NAME: a b c` (the name may be empty for a continuation row). */
function netRow(row: Row): { name: string; members: string[] } {
  const first = row.cells[0] ?? "";
  if (first.endsWith(":")) return { name: first.slice(0, -1), members: row.cells.slice(1) };
  return { name: first, members: row.cells.slice(1) };
}

/** A `ports` row: the port id and the net it names. */
function portRow(row: Row): { id: string; net: string } {
  return { id: row.cells[0] ?? "", net: row.cells[1] ?? "" };
}

/** A `pages` row: the page instance id and the page id. */
function pageRow(row: Row): { instance: string; page: string } {
  return { instance: row.cells[0] ?? "", page: row.cells[1] ?? "" };
}

/** The page instance id a member reference points at (`P1.SYS_OUT` -> `P1`), or null. */
function pageInstanceOf(reference: string): string | null {
  const dot = reference.indexOf(".");
  if (dot <= 0) return null;
  const head = reference.slice(0, dot);
  return /^P[0-9]+$/.test(head) ? head : null;
}

/** The part of a reference after the page instance prefix (`P2.C1.1` -> `C1.1`). */
function withoutPagePrefix(reference: string, instances: Set<string>): string | null {
  const dot = reference.indexOf(".");
  if (dot <= 0) return null;
  const head = reference.slice(0, dot);
  return instances.has(head) ? reference.slice(dot + 1) : null;
}

/** The key of the page net map: the page instance id and the page's net name. */
function pageNetKey(instance: string, net: string): string {
  return `${instance}|${net}`;
}

interface MergedBoard {
  /** The board's net name -> its members, in the order they were found. */
  nets: Map<string, string[]>;
  /** The page instance id -> the page's net name -> the board's net name. */
  netNames: Map<string, Map<string, string>>;
  /** The board's port ids. */
  boardPorts: Set<string>;
  /** The instance rows of the merged board, in order. */
  instances: Row[];
  /** The constraint rows of the merged board, in order. */
  constraints: Row[];
}

/**
 * Merge a board root and its pages into the flat model.
 *
 * Returns the merged model and the list of collisions. A collision means two pages disagree about a
 * name; the caller reports it and leaves the board alone.
 */
function mergeBoard(root: Doc, pages: PageData[]): { merged: MergedBoard; collisions: string[] } {
  const collisions: string[] = [];
  const netNames = new Map<string, Map<string, string>>();
  const nets = new Map<string, string[]>();
  const instances: Row[] = [];
  const constraints: Row[] = [];

  // The board root's own instances and constraints.
  for (const row of rowsOf(root, "instances")) instances.push(row);
  for (const row of rowsOf(root, "constraints")) constraints.push(row);

  // The board root's net rows: the members are page port references (`P1.SYS_OUT`).
  const boardNetOf = new Map<string, string>();
  const rootNets: { name: string; members: string[] }[] = [];
  const rootNetNames = new Set<string>();
  for (const row of rowsOf(root, "nets")) {
    const { name, members } = netRow(row);
    if (name === "") continue;
    rootNetNames.add(name);
    const kept: string[] = [];
    for (const member of members) {
      const instance = pageInstanceOf(member);
      if (instance === null) {
        kept.push(member);
        continue;
      }
      const page = pages.find((p) => p.instance === instance);
      const pageNet = page?.ports.get(member.slice(instance.length + 1));
      if (pageNet === undefined) {
        collisions.push(`the board net ${name} references ${member}, which is not a port of that page`);
        continue;
      }
      boardNetOf.set(pageNetKey(instance, pageNet), name);
    }
    rootNets.push({ name, members: kept });
  }

  // The pages: their instances, nets and constraints.
  const seenRefdes = new Map<string, string>();
  for (const page of pages) {
    for (const row of rowsOf(page.doc, "instances")) {
      const refdes = row.cells[0] ?? "";
      const owner = seenRefdes.get(refdes);
      if (owner !== undefined) {
        collisions.push(`refdes ${refdes} is used by ${owner} and by page ${page.instance}`);
        continue;
      }
      seenRefdes.set(refdes, page.instance);
      instances.push(row);
    }
    for (const row of rowsOf(page.doc, "constraints")) constraints.push(row);
  }

  // The nets: a page net that the board exports through a port merges into that board net; a page
  // net that the board does not export keeps its own name and becomes a board net of its own.
  const keptNames = new Map<string, string[]>();
  for (const page of pages) {
    const names = new Map<string, string>();
    for (const net of page.nets) {
      const boardNet = boardNetOf.get(pageNetKey(page.instance, net.name));
      if (boardNet !== undefined) {
        names.set(net.name, boardNet);
        const list = nets.get(boardNet) ?? [];
        list.push(...net.members);
        nets.set(boardNet, list);
        continue;
      }
      names.set(net.name, net.name);
      const owners = keptNames.get(net.name) ?? [];
      owners.push(page.instance);
      keptNames.set(net.name, owners);
    }
    netNames.set(page.instance, names);
  }

  // A page net that keeps its own name and meets a board net of the same name is a collision: in the
  // old model they were two different nets that happened to share a name.
  for (const [name, owners] of keptNames) {
    if (rootNetNames.has(name)) {
      collisions.push(
        `the board exports the net ${name} and page ${owners[0]} has a local net of the same name; rename one of them`,
      );
    }
    if (owners.length > 1) {
      collisions.push(`the net ${name} is used by several pages (${owners.join(", ")})`);
    }
  }

  // The board's net rows that no page filled: they keep their own members.
  for (const net of rootNets) {
    const list = nets.get(net.name) ?? [];
    list.push(...net.members);
    nets.set(net.name, list);
  }

  // The board's ports.
  const boardPorts = new Set<string>();
  for (const row of rowsOf(root, "ports")) boardPorts.add(portRow(row).id);

  // The constraint subjects of a page are page net names; they become board net names.
  const fixedConstraints: Row[] = [];
  for (const row of constraints) {
    const cells = [...row.cells];
    if (cells[0] === "voltage" || cells[0] === "current") {
      const subject = cells[1] ?? "";
      const owner = pages.find((p) => netNames.get(p.instance)?.has(subject));
      const boardNet = owner ? netNames.get(owner.instance)!.get(subject) : undefined;
      if (boardNet !== undefined) cells[1] = boardNet;
    }
    fixedConstraints.push({ ...row, cells });
  }

  return {
    merged: { nets, netNames, boardPorts, instances, constraints: fixedConstraints },
    collisions,
  };
}

/** Render the merged board as text; the formatter canonicalizes it. */
function renderMerged(root: Doc, merged: MergedBoard, pages: PageData[]): string {
  const lines: string[] = ["version 0.7", `schematic ${root.id}`, ""];
  for (const comment of root.leading) lines.push(comment);
  if (root.leading.length > 0) lines.push("");

  lines.push("instances");
  for (const row of merged.instances) {
    lines.push(...row.comments);
    lines.push(`  ${row.cells.join("  ")}`);
  }
  lines.push("");

  lines.push("nets");
  for (const [name, members] of merged.nets) {
    lines.push(`  ${name}:${members.length > 0 ? `  ${members.join("  ")}` : ""}`);
  }
  lines.push("");

  const ports = rowsOf(root, "ports");
  if (ports.length > 0) {
    lines.push("ports");
    for (const row of ports) {
      lines.push(...row.comments);
      lines.push(`  ${row.cells.join("  ")}`);
    }
    lines.push("");
  }

  if (merged.constraints.length > 0) {
    lines.push("constraints");
    for (const row of merged.constraints) {
      lines.push(...row.comments);
      lines.push(`  ${row.cells.join("  ")}`);
    }
    lines.push("");
  }

  for (const page of pages) {
    lines.push(`# page ${page.page} (${page.instance}) was merged into this board.`);
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Rewrite a print page: the page's net names become the board's net names. */
function rewriteView(text: string, names: Map<string, string>, boardPorts: Set<string>): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const cells = trimmed.split(/\s+/);
    if (cells.length === 1 && VIEW_SECTIONS.includes(cells[0]!)) {
      section = cells[0]!;
      out.push(line);
      continue;
    }
    if (section === "wire" || section === "label") {
      const net = cells[0] ?? "";
      const boardNet = names.get(net);
      if (boardNet !== undefined && boardNet !== net) {
        out.push(line.replace(net, boardNet));
        continue;
      }
    }
    if (section === "port") {
      const id = cells[0] ?? "";
      if (!boardPorts.has(id)) {
        note(
          `the print page names the port ${id}, which is not a board port; replace it with a board port id or a label`,
        );
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Rewrite a pcb description: the instance ids and net names lose their page prefix. */
function rewritePcb(text: string, instances: Set<string>, names: Map<string, Map<string, string>>): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      out.push(line);
      continue;
    }
    const cells = trimmed.split(/\s+/);
    if (cells.length === 1 && PCB_SECTIONS.includes(cells[0]!)) {
      section = cells[0]!;
      out.push(line);
      continue;
    }
    if (section === "place" && cells.length > 0) {
      out.push(line.replace(cells[0]!, withoutPagePrefix(cells[0]!, instances) ?? cells[0]!));
      continue;
    }
    if (section === "connect" && cells.length >= 2) {
      const first = withoutPagePrefix(cells[0]!, instances) ?? cells[0]!;
      const second = withoutPagePrefix(cells[1]!, instances) ?? cells[1]!;
      out.push(line.replace(cells[0]!, first).replace(cells[1]!, second));
      continue;
    }
    if ((section === "trace" || section === "via" || section === "zone") && cells.length > 0) {
      const net = cells[0]!;
      const instance = pageInstanceOf(net);
      let replacement = net;
      if (instance !== null) {
        const pageNet = net.slice(instance.length + 1);
        const boardNet = names.get(instance)?.get(pageNet);
        replacement = boardNet ?? pageNet;
      }
      out.push(line.replace(net, replacement));
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Replace the version line with 0.7. */
function withVersion07(text: string): string {
  return text.replace(/^(\s*version\s+)\S+/m, "$10.7");
}

function main(): number {
  const projectRoot = process.argv[2] ?? "examples/reference-project";
  const schDir = join(projectRoot, "sch");
  if (!existsSync(schDir)) {
    console.error(`No sch directory: ${schDir}`);
    return 2;
  }
  const boards = readdirSync(schDir)
    .filter((name) => name.endsWith(".teda"))
    .sort();
  let migrated = 0;
  for (const name of boards) {
    const boardId = name.slice(0, name.length - ".teda".length);
    const boardFile = join(schDir, name);
    const root = readDoc(readFileSync(boardFile, "utf8"));
    if (!root.sections.has("pages")) continue;

    console.log(`Board ${boardId}: merging the pages into one file`);
    const pages: PageData[] = [];
    for (const row of rowsOf(root, "pages")) {
      const { instance, page } = pageRow(row);
      const pageFile = join(schDir, boardId, `${page}.teda`);
      if (!existsSync(pageFile)) {
        fail(`the page file ${pageFile} is missing`);
        continue;
      }
      const doc = readDoc(readFileSync(pageFile, "utf8"));
      const ports = new Map<string, string>();
      for (const row of rowsOf(doc, "ports")) {
        const { id, net } = portRow(row);
        ports.set(id, net);
      }
      const nets = rowsOf(doc, "nets")
        .map((row) => netRow(row))
        .filter((net) => net.name !== "");
      pages.push({ instance, page, doc, ports, nets });
    }
    if (problems.length > 0) continue;

    const { merged, collisions } = mergeBoard(root, pages);
    if (collisions.length > 0) {
      for (const collision of collisions) fail(`sch/${name}: ${collision}`);
      console.log(`  x ${boardId} was not migrated: resolve the names and run the migration again`);
      continue;
    }

    const mergedText = renderMerged(root, merged, pages);
    const formatted = formatSchematic(mergedText, { file: `sch/${name}` });
    if (!formatted.ok || formatted.text === undefined) {
      fail(
        `sch/${name}: the merged board does not compile: ${formatted.diagnostics[0]?.message ?? "unknown error"}`,
      );
      continue;
    }

    // Everything is computed before anything is written: a board is migrated as a whole or not at all.
    const writes: { path: string; text: string }[] = [{ path: boardFile, text: formatted.text }];
    for (const page of pages) {
      const viewFile = join(schDir, boardId, `${page.page}.view.teda`);
      if (!existsSync(viewFile)) continue;
      const names = merged.netNames.get(page.instance) ?? new Map<string, string>();
      const text = withVersion07(rewriteView(readFileSync(viewFile, "utf8"), names, merged.boardPorts));
      const formattedView = formatView(text, { file: `sch/${boardId}/${page.page}.view.teda` });
      if (!formattedView.ok || formattedView.text === undefined) {
        const reason = formattedView.diagnostics[0]?.message ?? "unknown error";
        fail(`sch/${boardId}/${page.page}.view.teda: the rewritten print page does not compile: ${reason}`);
        continue;
      }
      writes.push({ path: viewFile, text: formattedView.text });
    }

    const pcbFile = join(projectRoot, "pcb", `${boardId}.teda`);
    if (existsSync(pcbFile)) {
      const instances = new Set(pages.map((p) => p.instance));
      const text = withVersion07(rewritePcb(readFileSync(pcbFile, "utf8"), instances, merged.netNames));
      const formattedPcb = formatPcb(text, { file: `pcb/${boardId}.teda` });
      if (!formattedPcb.ok || formattedPcb.text === undefined) {
        const reason = formattedPcb.diagnostics[0]?.message ?? "unknown error";
        fail(`pcb/${boardId}.teda: the rewritten pcb description does not compile: ${reason}`);
      } else {
        writes.push({ path: pcbFile, text: formattedPcb.text });
      }
    }

    if (problems.length > 0) {
      console.log(`  x ${boardId} was not migrated: fix the problems above and run the migration again`);
      continue;
    }

    for (const write of writes) writeFileSync(write.path, write.text);
    for (const page of pages) {
      unlinkSync(join(schDir, boardId, `${page.page}.teda`));
    }

    console.log(`  + ${boardId} is now one flat file (version 0.7)`);
    migrated += 1;
  }
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s); nothing was migrated.`);
    return 1;
  }
  console.log(`\nMigrated ${migrated} board(s) to language 0.7.`);
  return 0;
}

process.exit(main());
