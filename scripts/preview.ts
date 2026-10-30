#!/usr/bin/env bun
// Preview: draw symbols / footprints from the library as SVG, drawn by ourselves, without borrowing KiCad.
//
//   bun run preview symbol   <id> [--class <class>] [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview footprint <id> [--class <class>] [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview component <id> [--out <dir>] [--project <dir>] [--scale <n>]
//   bun run preview view      <board>/<print_page> [--out <dir>] [--project <dir>] [--scale <n>]
//
// Purpose: after an agent builds a footprint/symbol it wants to take an immediate look (pin orientation, arrows, courtyard, silkscreen over pads);
// these all pass green in the IR and contract validation — validation only checks self-consistency, not whether it looks right.
// Output: the SVG path is printed to stdout; artifacts land in /tmp/texteda-preview/<id>/ (changeable with --out).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { formatDiagnostic, parseComponent, parseSchematic, parseView } from "@texteda/parser";
import { instanceValueText } from "../packages/cli/src/symbols.ts";
import {
  renderFootprint,
  renderSchematic,
  renderSymbol,
  toSvgText,
  validateDoc,
  type SchematicInstance,
} from "@texteda/renderer";
import { unsupportedChars } from "@texteda/core/font";
import {
  componentUsingSymbol,
  deviceFiles,
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
  /** The classification directory (ADR-0049); `null` = search every one of them. */
  klass: string | null;
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
  let klass: string | null = null;
  let out: string | null = null;
  let project = "examples/reference-project";
  let scale = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--class") klass = argv[++i] ?? fail("--class must be followed by a class directory");
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
  return { kind, id, klass, out, project, scale };
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

/** `<class>:<name>` → class directory and name; a bare name keeps `undefined` for the class. */
function splitRef(ref: string): { klass: string | undefined; name: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { klass: undefined, name: ref };
  return { klass: ref.slice(0, i), name: ref.slice(i + 1) };
}

/**
 * The file of an asset: the named class directory when one is given, otherwise the whole tree, in
 * which case the id has to be unique. Classification directories are one level (ADR-0049).
 */
function findAssetFile(root: string, group: "symbols" | "footprints", klass: string | null, id: string): string | null {
  const base = join(root, "assets", group);
  if (klass !== null) {
    const file = join(base, klass, `${id}.teda`);
    return existsFile(file) ? file : null;
  }
  const found = tedaFiles(base).filter((file) => basename(file, ".teda") === id);
  if (found.length > 1) {
    fail(
      `${id} exists in more than one class directory:\n  ${found.join("\n  ")}\n  pass --class to pick one`,
    );
  }
  return found[0] ?? null;
}

/** The device file with the given id (parts and generics alike live in assets/components/). */
function findComponentFile(projectRoot: string, id: string): string | null {
  return deviceFiles(projectRoot).find((f) => basename(f, ".teda") === id) ?? null;
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
  let symbolClass = options.klass;
  let part: { pins: { number: string; name: string; type: string }[] } | null = null;
  if (options.kind === "component") {
    const file = findComponentFile(projectRoot, options.id);
    if (!file) fail(`no component ${options.id} in the project`);
    const text = readFileSync(file, "utf8");
    const ref = readRef(text, "symbol");
    if (!ref) fail(`component ${options.id} has no symbol reference`);
    const split = splitRef(ref);
    symbolClass = split.klass ?? null;
    symbolId = split.name;
    const facts = loadComponent(file);
    if (!facts.ok) fail(`component ${options.id} could not be read`);
    part = {
      pins: facts.value.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
    };
  }
  const file = findAssetFile(projectRoot, "symbols", symbolClass, symbolId);
  if (file === null) {
    fail(`symbol not found: ${symbolClass === null ? symbolId : `${symbolClass}:${symbolId}`} under assets/symbols/`);
  }
  const klass = basename(dirname(file));
  const parsed = loadSymbol(file, klass);
  if (!parsed.ok) {
    console.error(parsed.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
    fail(`symbol ${symbolId} failed to compile`);
  }
  if (!part && options.kind === "symbol") {
    const owner = componentUsingSymbol(projectRoot, `${klass}:${symbolId}`);
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
  if (!part) {
    console.error(
      `  ! no component references ${klass}:${symbolId}, pin names cannot be drawn (rendered with empty names)`,
    );
  }
  const doc = renderSymbol(parsed.value.symbol, { pins: part?.pins ?? [] });
  written.push(writeSvg(`${symbolId}.symbol`, doc));
}

if (options.kind === "footprint" || options.kind === "component") {
  let footprintId = options.id;
  let footprintClass = options.klass;
  if (options.kind === "component") {
    const file = findComponentFile(projectRoot, options.id);
    if (!file) fail(`no component ${options.id} in the project`);
    const ref = readRef(readFileSync(file, "utf8"), "footprint");
    if (!ref) fail(`component ${options.id} has no footprint reference`);
    const split = splitRef(ref);
    footprintClass = split.klass ?? null;
    footprintId = split.name;
  }
  const file = findAssetFile(projectRoot, "footprints", footprintClass, footprintId);
  if (file === null) {
    fail(
      `footprint not found: ${footprintClass === null ? footprintId : `${footprintClass}:${footprintId}`} under assets/footprints/`,
    );
  }
  const parsed = loadFootprint(file, basename(dirname(file)));
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
  // (M1.U1 for a module instance, ADR-0013 decision 2).
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

  // The view names the board's instances by their board-level id (ADR-0012, ADR-0013).
  const componentOf = new Map(parsedBoard.ir.instances.map((i) => [i.id, i.component]));
  const rowOf = new Map(parsedBoard.ir.instances.map((i) => [i.id, i]));
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
    const split = splitRef(symbolRef);
    const symbolFile = findAssetFile(projectRoot, "symbols", split.klass ?? null, split.name);
    if (symbolFile === null) {
      fail(`symbol ${symbolRef} of component ${componentId} not found under assets/symbols/`);
    }
    const symbol = loadSymbol(symbolFile, basename(dirname(symbolFile)));
    if (!symbol.ok) {
      console.error(symbol.diagnostics.map((d) => `  ${formatDiagnostic(d)}`).join("\n"));
      fail(`symbol ${symbolRef} failed to compile`);
    }
    // The symbol's Value field is a placeholder; the instance's `value` column is what a reader
    // needs (the same substitution the CLI makes).
    const declared = parseComponent(readFileSync(componentFile, "utf8"), { file: componentFile });
    const value = instanceValueText(rowOf.get(place.instance_id)!, {
      params: declared.component?.params ?? [],
      ...(declared.component?.mpn === undefined ? {} : { mpn: declared.component.mpn }),
    });
    instances.set(place.instance_id, {
      symbol: symbol.value.symbol,
      part: {
        pins: facts.value.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
      },
      ...(value === undefined ? {} : { value }),
    });
  }

  const doc = renderSchematic(parsedView.ir, instances);
  written.push(writeSvg(`${board}-${page}.view`, doc));
}

for (const path of written) console.log(path);
