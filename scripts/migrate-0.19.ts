#!/usr/bin/env bun
// Migration to language 0.19 / IR v0.23 (ADR-0081): remove schematic net-current rows without
// guessing a PCB rule. Every input is inspected before the first project file is written.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { lex, parseQuantity } from "@texteda/parser";

const TARGET_VERSION = "0.19.0";
const TARGET_FORMAT = "0.19";
const TARGET_MINOR = 19;
const SECTION_HEADERS = new Set([
  "modules", "instances", "nets", "ports", "constraints", "bus", "interconnects", "interconnect_pins",
  "stackup", "outline", "place", "connect", "trace", "via", "zone", "keepout", "rules", "silk",
  "physical_only", "deviation", "params", "pins", "ratings", "fields", "pads", "graphics", "models",
  "alternatives", "selections", "items", "wires", "labels", "junctions", "text",
]);
const PIN_REF_RE = /^(?:[A-Z]+[0-9]+\.)?[A-Z]+[0-9]+\.[A-Za-z0-9_+-]+$/;
const VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/;
const problems: string[] = [];
const fail = (message: string): void => { problems.push(message); };
const rel = (root: string, path: string): string => relative(root, path).replaceAll("\\", "/");

type TedaFile = { path: string; relativePath: string; text: string };

function collectTedaFiles(root: string, directory: string): string[] {
  const path = join(root, directory);
  if (!existsSync(path)) return [];
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch (error) {
    fail(`${rel(root, path)}: cannot read directory: ${String(error)}`);
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...collectTedaFiles(root, rel(root, child)));
    else if (entry.isFile() && entry.name.endsWith(".teda")) found.push(child);
    else if (entry.name.endsWith(".teda")) fail(`${rel(root, child)}: expected a regular file or directory`);
  }
  return found;
}

function compareVersion(text: string): number | null {
  const match = VERSION_RE.exec(text);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? 0);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  if (major !== 0) return 1;
  return minor < TARGET_MINOR ? -1 : minor === TARGET_MINOR ? 0 : 1;
}

function migrateDescription(root: string, file: TedaFile, writes: Map<string, string>): void {
  const lines = lex(file.text);
  const significant = lines.find((line) => !line.blank && !line.comment);
  if (!significant || significant.cells.length !== 2 || significant.cells[0]!.text !== "version") {
    fail(`${file.relativePath}: expected a 'version <language-version>' header`);
    return;
  }
  const versionText = significant.cells[1]!.text;
  const relation = compareVersion(versionText);
  if (relation === null) {
    fail(`${file.relativePath}:${significant.number}: invalid language version '${versionText}'`);
    return;
  }
  if (relation > 0) {
    fail(`${file.relativePath}:${significant.number}: version ${versionText} is newer than migration target ${TARGET_VERSION}`);
    return;
  }

  const nets = new Set<string>();
  const busNets = new Set<string>();
  const busIds = new Set<string>();
  const railRows: { line: number; net: string; value: string }[] = [];
  const descriptionType = lines.find((line) => !line.blank && !line.comment && line !== significant)?.cells[0]?.text;
  let section = "";
  let lastNet: string | null = null;
  let busId: string | null = null;
  let lastBusMember: string | null = null;
  for (const line of lines) {
    if (line.blank || line.comment || line.cells.length === 0) continue;
    const cells = line.cells.map((cell) => cell.text);
    if (cells[0] === "bus" && (descriptionType === "module" || descriptionType === "schematic")) {
      if (descriptionType !== "module") {
        fail(`${file.relativePath}:${line.number}: bus declarations are only valid in module files`);
        section = "";
        busId = null;
        continue;
      }
      if (cells.length !== 4 || cells[2] !== "=") {
        fail(`${file.relativePath}:${line.number}: cannot safely parse bus declaration; expected 'bus <id> = <type>'`);
        section = "";
        busId = null;
        continue;
      }
      busId = cells[1]!;
      if (busIds.has(busId)) fail(`${file.relativePath}:${line.number}: duplicate bus declaration '${busId}'`);
      busIds.add(busId);
      section = "bus";
      lastBusMember = null;
      lastNet = null;
      continue;
    }
    if (cells.length === 1 && SECTION_HEADERS.has(cells[0]!)) {
      section = cells[0]!;
      busId = null;
      lastBusMember = null;
      lastNet = null;
      continue;
    }
    if (section === "bus" && busId !== null) {
      const head = cells[0]!;
      if (head === ":") {
        if (lastBusMember === null) fail(`${file.relativePath}:${line.number}: bus continuation has no preceding member`);
        continue;
      }
      const name = head.endsWith(":") ? head.slice(0, -1) : head;
      if (name === "") {
        fail(`${file.relativePath}:${line.number}: cannot safely identify a bus member`);
        continue;
      }
      lastBusMember = name;
      busNets.add(`${busId}.${name}`);
      continue;
    }
    if (section === "nets") {
      const head = cells[0]!;
      if (head === ":") {
        if (lastNet === null) fail(`${file.relativePath}:${line.number}: net continuation has no preceding net`);
        continue;
      }
      const name = head.endsWith(":") ? head.slice(0, -1) : head;
      if (/^[A-Za-z0-9_+-]+$/.test(name)) {
        nets.add(name);
        lastNet = name;
      } else fail(`${file.relativePath}:${line.number}: cannot safely identify a net row in the nets section`);
    }
    if (section !== "constraints" || cells[0] !== "current") continue;
    if (cells.length !== 3) {
      fail(`${file.relativePath}:${line.number}: cannot safely migrate current constraint; expected exactly 'current <subject> <max>'`);
      continue;
    }
    const quantity = parseQuantity(cells[2]!, "current", { code: "value.invalid-value" });
    if (!quantity.ok) {
      fail(`${file.relativePath}:${line.number}: cannot safely migrate invalid current maximum '${cells[2]}'`);
      continue;
    }
    const subject = cells[1]!;
    const isBusNet = busNets.has(subject);
    const isNet = nets.has(subject) || isBusNet;
    const looksLikePin = PIN_REF_RE.test(subject);
    if (isNet && looksLikePin && !isBusNet) {
      fail(`${file.relativePath}:${line.number}: current subject '${subject}' is both a declared net and pin-shaped; resolve it manually`);
      continue;
    }
    if (isNet) railRows.push({ line: line.number, net: subject, value: cells[2]! });
    else if (!looksLikePin) fail(`${file.relativePath}:${line.number}: cannot resolve current subject '${subject}' as a declared net or pin`);
  }

  if (problems.some((problem) => problem.startsWith(`${file.relativePath}:`))) return;
  const sourceLines = file.text.split("\n");
  const versionLine = sourceLines[significant.number - 1];
  if (versionLine === undefined) {
    fail(`${file.relativePath}:${significant.number}: cannot safely rewrite version header`);
    return;
  }
  const versionMatch = /^(\s*version\s+)\S+(\s*)$/.exec(versionLine);
  if (!versionMatch) {
    fail(`${file.relativePath}:${significant.number}: cannot safely rewrite version header`);
    return;
  }
  if (relation < 0) sourceLines[significant.number - 1] = `${versionMatch[1]}${TARGET_VERSION}${versionMatch[2]}`;
  for (const row of railRows) {
    sourceLines[row.line - 1] = `# TODO(F88): review rail ${row.net} maximum current ${row.value}; add a reviewed PCB rules current row with min_width and source before enabling.`;
  }
  const migrated = sourceLines.join("\n");
  if (migrated !== file.text) writes.set(join(root, file.relativePath), migrated);
}

function rewriteProjectFormat(root: string, projectFile: string, writes: Map<string, string>): void {
  let text: string;
  try {
    text = readFileSync(projectFile, "utf8");
  } catch (error) {
    fail(`project.toml: cannot read source: ${String(error)}`);
    return;
  }
  const lines = text.split("\n");
  let table = "";
  let formatRows: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const tableMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(lines[index]!);
    if (tableMatch) table = tableMatch[1]!;
    if (table === "project" && /^\s*format\s*=/.test(lines[index]!)) formatRows.push(index);
  }
  if (formatRows.length !== 1) {
    fail(`project.toml: expected exactly one [project].format key, found ${formatRows.length}`);
    return;
  }
  const index = formatRows[0]!;
  const match = /^(\s*format\s*=\s*)(["'])([^"']+)\2(\s*(?:#.*)?)$/.exec(lines[index]!);
  if (!match) {
    fail(`project.toml:${index + 1}: cannot safely rewrite format; expected a quoted value`);
    return;
  }
  const relation = compareVersion(match[3]!);
  if (relation === null) {
    fail(`project.toml:${index + 1}: invalid language format '${match[3]}'`);
    return;
  }
  if (relation > 0) {
    fail(`project.toml:${index + 1}: format ${match[3]} is newer than migration target ${TARGET_FORMAT}`);
    return;
  }
  lines[index] = `${match[1]}"${TARGET_FORMAT}"${match[4]}`;
  const migrated = lines.join("\n");
  if (migrated !== text) writes.set(projectFile, migrated);
}

function main(): number {
  const arg = process.argv[2];
  if (!arg || process.argv.length > 3) {
    console.error("usage: bun run migrate:0.19 <project dir>");
    return 2;
  }
  const root = resolve(arg);
  const projectFile = join(root, "project.toml");
  if (!existsSync(projectFile) || !existsSync(join(root, "design"))) {
    console.error(`${root}: not a TextEDA project (expected project.toml and design/)`);
    return 1;
  }

  const paths = ["design", "assets", "views"].flatMap((directory) => collectTedaFiles(root, directory)).sort();
  const files: TedaFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path, relativePath: rel(root, path), text: readFileSync(path, "utf8") });
    } catch (error) {
      fail(`${rel(root, path)}: cannot read source: ${String(error)}`);
    }
  }
  const writes = new Map<string, string>();
  for (const file of files) migrateDescription(root, file, writes);
  rewriteProjectFormat(root, projectFile, writes);
  if (problems.length > 0) {
    console.error(`Migration refused: ${problems.length} unresolved prerequisite${problems.length === 1 ? "" : "s"}. No project files were changed.`);
    for (const problem of problems) console.error(`  x ${problem}`);
    return 1;
  }
  if (writes.size === 0) {
    console.log("Project already uses the 0.19 language surface; nothing to migrate.");
    return 0;
  }

  let stage: string | undefined;
  const staged: { destination: string; source: string }[] = [];
  const backups: { destination: string; backup: string }[] = [];
  const installed: string[] = [];
  try {
    stage = mkdtempSync(join(root, ".migrate-0.19-"));
    let index = 0;
    for (const [destination, text] of writes) {
      const source = join(stage, `write-${index++}`);
      writeFileSync(source, text, "utf8");
      staged.push({ destination, source });
    }
    for (let index = 0; index < staged.length; index += 1) {
      const item = staged[index]!;
      const backup = join(stage, `backup-${index}`);
      renameSync(item.destination, backup);
      backups.push({ destination: item.destination, backup });
      renameSync(item.source, item.destination);
      installed.push(item.destination);
    }
  } catch (error) {
    console.error(`Migration failed during commit: ${String(error)}; restoring original project files.`);
    for (const path of installed.reverse()) { try { unlinkSync(path); } catch { /* rollback continues */ } }
    for (const item of backups.reverse()) { try { renameSync(item.backup, item.destination); } catch { /* rollback continues */ } }
    if (stage) rmSync(stage, { recursive: true, force: true });
    return 1;
  }
  if (stage) rmSync(stage, { recursive: true, force: true });
  console.log(`Migrated ${writes.size} project file(s) to language ${TARGET_FORMAT}.`);
  console.log("Removed schematic net-current rows were retained as TODO(F88) comments; no PCB current rule was inferred.");
  return 0;
}

process.exitCode = main();
