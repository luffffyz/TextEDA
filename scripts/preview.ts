#!/usr/bin/env bun
// Preview: draw symbols / footprints from the library as SVG, drawn by ourselves, without borrowing KiCad.
//
//   bun run preview symbol   <id> [--lib <name>] [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview footprint <id> [--lib <name>] [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview component <id> [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview view      <board>/<print_page> [--out <dir>] [--project <dir>] [--scale <n>]
//
// Purpose: after an agent builds a footprint/symbol it wants to take an immediate look (pin orientation, arrows, courtyard, silkscreen over pads);
// these all pass green in the IR and contract validation — validation only checks self-consistency, not whether it looks right.
// Output: the SVG path is printed to stdout; artifacts land in /tmp/texteda-preview/<id>/ (changeable with --out).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { formatDiagnostic, parseSchematic, parseView } from "@texteda/parser";
import {
  renderFootprint,
  renderSchematic,
  renderSymbol,
  toSvgText,
  validateDoc,
  type SchematicInstance,
} from "@texteda/renderer";
import { unsupportedChars } from "@texteda/renderer/font";
import {
  componentUsingSymbol,
  loadComponent,
  loadComponentResolver,
  loadFootprint,
  loadModuleSources,
  loadSymbol,
  tedaFiles,
} from "./lib/project.ts";

interface Options {
  kind: "symbol" | "footprint" | "component" | "view";
  id: string;
  lib: string;
  out: string | null;
  project: string;
  scale: number;
}

function fail(message: string): never {
  console.error(`preview failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  let lib = "project";
  let out: string | null = null;
  let project = "examples/reference-project";
  let scale = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--lib") lib = argv[++i] ?? fail("--lib must be followed by a library name");
    else if (arg === "--out") out = argv[++i] ?? fail("--out must be followed by a directory");
    else if (arg === "--project") project = argv[++i] ?? fail("--project must be followed by a directory");
    else if (arg === "--scale") scale = Number(argv[++i] ?? fail("--scale must be followed by a multiplier"));
    else if (arg.startsWith("--")) fail(`unknown argument ${arg}`);
    else positional.push(arg);
  }
  const kind = positional[0];
  const id = positional[1];
  if (
    kind !== "symbol" &&
    kind !== "footprint" &&
    kind !== "component" &&
    kind !== "view"
  ) {
    fail("usage: preview symbol|footprint|component|view <id>");
  }
  if (!id) fail("usage: preview symbol|footprint|component|view <id>");
  if (kind === "view" && !/^[^/]+\/[^/]+$/.test(id)) {
    fail("usage: preview view <board>/<print_page>");
  }
  if (!Number.isFinite(scale) || scale <= 0) fail("--scale must be a positive number");
  return { kind, id, lib, out, project, scale };
}

function existsDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function existsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function readRef(text: string, key: "symbol" | "footprint"): string | null {
  const m = new RegExp(`^${key}\\s+(\\S+)$`, "m").exec(text);
  return m ? m[1]! : null;
}

/** `lib:name` → library name and name; if no library is given, use the default library. */
function splitRef(ref: string, defaultLib: string): { lib: string; name: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { lib: defaultLib, name: ref };
  return { lib: ref.slice(0, i), name: ref.slice(i + 1) };
}

/** The component file with the given id (under assets/components/, one directory per category). */
function findComponentFile(projectRoot: string, id: string): string | null {
  return (
    tedaFiles(join(projectRoot, "assets/components")).find((f) => basename(f, ".teda") === id) ?? null
  );
}

const options = parseArgs(process.argv.slice(2));
const projectRoot = resolve(options.project);
if (!existsDir(projectRoot)) fail(`project directory does not exist: ${options.project}`);

const outDir = options.out
  ? resolve(options.out)
  : join("/tmp", "texteda-preview", options.id);
mkdirSync(outDir, { recursive: true });

function writeSvg(name: string, doc: ReturnType<typeof renderSymbol>): string {
  const problems = validateDoc(doc);
  // The built-in font is ASCII only: characters that cannot be drawn must be reported, not silently vanish from the image.
  const missing = new Set<string>();
  for (const p of doc.primitives) {
    if (p.kind !== "text") continue;
    for (const ch of unsupportedChars(p.text)) missing.add(ch);
  }
  if (missing.size > 0) {
    console.error(`  ! ${name} has characters that cannot be drawn (built-in font is ASCII only): ${[...missing].join(" ")}`);
  }
  if (problems.length > 0) {
    console.error(`  ! ${name} graphics self-check found ${problems.length} problems:`);
    for (const p of problems.slice(0, 5)) console.error(`    ${p}`);
  }
  const path = join(outDir, `${name}.svg`);
  // Scaling only changes width/height, not the viewBox: the geometric proportions stay the same, making details easy to inspect by eye.
  const svg = toSvgText(doc).replace(
    /width="([\d.]+)mm" height="([\d.]+)mm"/,
    (_, w: string, h: string) =>
      `width="${(Number(w) * options.scale).toFixed(3)}mm" height="${(Number(h) * options.scale).toFixed(3)}mm"`,
  );
  writeFileSync(path, svg);
  return path;
}

const written: string[] = [];

if (options.kind === "symbol" || options.kind === "component") {
  let symbolId = options.id;
  let symbolLib = options.lib;
  let part: { pins: { number: string; name: string; type: string }[] } | null = null;
  if (options.kind === "component") {
    const file = tedaFiles(join(projectRoot, "assets/components")).find(
      (f) => basename(f, ".teda") === options.id,
    );
    if (!file) fail(`no component ${options.id} in the project`);
    const text = readFileSync(file, "utf8");
    const ref = readRef(text, "symbol");
    if (!ref) fail(`component ${options.id} has no symbol reference`);
    const split = splitRef(ref, options.lib);
    symbolLib = split.lib;
    symbolId = split.name;
    const facts = loadComponent(file);
    if (!facts.ok) fail(`component ${options.id} could not be read`);
    part = {
      pins: facts.value.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
    };
  } else {
    const owner = componentUsingSymbol(projectRoot, `${options.lib}:${symbolId}`);
    part = owner
      ? {
          pins: owner.facts.pins.map((p) => ({
            number: p.number,
            name: p.name,
            type: p.type,
          })),
        }
      : null;
  }
  const file = join(projectRoot, "assets/symbols", symbolLib, `${symbolId}.teda`);
  if (!existsDir(join(projectRoot, "assets/symbols", symbolLib)) || !existsFile(file)) {
    fail(`symbol not in library ${symbolLib}:${symbolId} (looked for ${file})`);
  }
  const parsed = loadSymbol(file, symbolLib);
  if (!parsed.ok) {
    console.error(parsed.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`symbol ${symbolId} failed to compile`);
  }
  if (!part) {
    console.error(
      `  ! no component references ${symbolLib}:${symbolId}, pin names cannot be drawn (rendered with empty names)`,
    );
  }
  const doc = renderSymbol(parsed.value.symbol, { pins: part?.pins ?? [] });
  written.push(writeSvg(`${symbolId}.symbol`, doc));
}

if (options.kind === "footprint" || options.kind === "component") {
  let footprintId = options.id;
  let footprintLib = options.lib;
  if (options.kind === "component") {
    const file = tedaFiles(join(projectRoot, "assets/components")).find(
      (f) => basename(f, ".teda") === options.id,
    );
    if (!file) fail(`no component ${options.id} in the project`);
    const ref = readRef(readFileSync(file, "utf8"), "footprint");
    if (!ref) fail(`component ${options.id} has no footprint reference`);
    const split = splitRef(ref, options.lib);
    footprintLib = split.lib;
    footprintId = split.name;
  }
  const file = join(projectRoot, "assets/footprints", footprintLib, `${footprintId}.teda`);
  if (!existsDir(join(projectRoot, "assets/footprints", footprintLib)) || !existsFile(file)) {
    fail(`footprint not in library ${footprintLib}:${footprintId} (looked for ${file})`);
  }
  const parsed = loadFootprint(file, footprintLib);
  if (!parsed.ok) {
    console.error(parsed.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`footprint ${footprintId} failed to compile`);
  }
  const doc = renderFootprint(parsed.value.footprint);
  written.push(writeSvg(`${footprintId}.footprint`, doc));
}

if (options.kind === "view") {
  const [board, page] = options.id.split("/") as [string, string];
  const boardFile = join(projectRoot, "design/sch", `${board}.teda`);
  if (!existsFile(boardFile)) fail(`board not found: ${boardFile}`);
  // The board is flattened first: a board composes modules, and the view names the flat ids
  // (M1.U1 for a module instance, ADR-0026 decision 2).
  const parsedBoard = parseSchematic(readFileSync(boardFile, "utf8"), {
    file: `sch/${board}.teda`,
    board,
    components: loadComponentResolver(projectRoot),
    modules: loadModuleSources(projectRoot),
  });
  if (!parsedBoard.ok || !parsedBoard.ir) {
    console.error(parsedBoard.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`board ${board} failed to parse`);
  }

  const viewFile = join(projectRoot, "views", board, `${page}.view.teda`);
  if (!existsFile(viewFile)) {
    fail(`no print page ${options.id} (looked for ${viewFile})`);
  }
  const parsedView = parseView(readFileSync(viewFile, "utf8"), {
    file: `sch/${board}/${page}.view.teda`,
    board,
  });
  if (!parsedView.ok || !parsedView.ir) {
    console.error(parsedView.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`view ${options.id} failed to parse`);
  }

  // The view names the board's instances by their board-level id (ADR-0025, ADR-0026).
  const componentOf = new Map(parsedBoard.ir.instances.map((i) => [i.id, i.component]));
  const instances = new Map<string, SchematicInstance>();
  for (const place of parsedView.ir.place) {
    const componentId = componentOf.get(place.instance_id);
    if (!componentId) {
      fail(`view places ${place.instance_id}, which is not an instance of board ${board}`);
    }
    const componentFile = findComponentFile(projectRoot, componentId);
    if (!componentFile) fail(`no component ${componentId} for instance ${place.instance_id}`);
    const facts = loadComponent(componentFile);
    if (!facts.ok) {
      console.error(facts.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
      fail(`component ${componentId} could not be read`);
    }
    const symbolRef = readRef(readFileSync(componentFile, "utf8"), "symbol");
    if (!symbolRef) fail(`component ${componentId} has no symbol reference`);
    const split = splitRef(symbolRef, options.lib);
    const symbolFile = join(projectRoot, "assets/symbols", split.lib, `${split.name}.teda`);
    if (!existsFile(symbolFile)) {
      fail(`symbol ${split.lib}:${split.name} not found (looked for ${symbolFile})`);
    }
    const symbol = loadSymbol(symbolFile, split.lib);
    if (!symbol.ok) {
      console.error(symbol.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
      fail(`symbol ${split.lib}:${split.name} failed to compile`);
    }
    instances.set(place.instance_id, {
      symbol: symbol.value.symbol,
      part: {
        pins: facts.value.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
      },
    });
  }

  const doc = renderSchematic(parsedView.ir, instances);
  written.push(writeSvg(`${board}-${page}.view`, doc));
}

for (const path of written) console.log(path);
