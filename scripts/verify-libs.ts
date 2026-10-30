#!/usr/bin/env bun
// Library-level validation: every component in the reference project resolves to self-built symbols/footprints, and every library file compiles,
// exports, and can be drawn by our own renderer.
//
// Usage:
//   bun run lib:verify [project dir]        required section, **zero external dependencies** (no KiCad needed)
//   bun run lib:verify:kicad [project dir]  append the KiCad interoperability section (optional)
//
// Required section (zero dependencies):
//   1. every component's symbol / footprint points to a project self-built library (no external prefixes like kicad:);
//   2. referenced library files exist; symbol pin number set == component pin number set; footprint pad number set ⊇ component pin number set;
//   3. every library file is canonical form, compiles to IR, and passes the contract;
//   4. every footprint states its package code (ADR-0028 decision 1);
//   5. exporting .kicad_sym / .kicad_mod succeeds; render with **our own** renderer and self-check.
//
// Optional section (--kicad, KiCad on PATH):
//   6. KiCad can parse .kicad_sym / .kicad_mod (sym upgrade / fp export svg);
//   7. all footprints placed on one board, `kicad-cli pcb drc` 0 violations.
//
// Why split them: KiCad's parsing and DRC are **cross-validation** (a third-party implementation accepts us),
// not our definition of correctness. Making it a required item turns "a third party accepts us" into
// "the premise of our existence", and would also make TextEDA require KiCad to be used. ADR-0021.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validate } from "@texteda/ir";
import { footprintInline, footprintModule, symbolLibrary } from "@texteda/exporter";
import { renderFootprint, renderSymbol, toSvgText, validateDoc } from "@texteda/renderer";
import {
  canonicalJson,
  formatDiagnostic,
  formatFootprint,
  formatSymbol,
  parseFootprint,
  parseSymbol,
  readComponentFacts,
} from "@texteda/parser";

const useKicad = process.argv.includes("--kicad");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const projectRoot = positional[0] ?? "examples/reference-project";
const libName = "project";
const work = "/tmp/texteda-lib-verify";
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "project.pretty"), { recursive: true });
mkdirSync(join(work, "svg"), { recursive: true });
mkdirSync(join(work, "symbol-svg"), { recursive: true });
mkdirSync(join(work, "footprint-svg"), { recursive: true });

const problems: string[] = [];
const fail = (message: string): void => {
  problems.push(message);
  console.error(`  ✗ ${message}`);
};

function listTeda(dir: string): string[] {
  const out: string[] = [];
  if (!statSync(dir).isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTeda(full));
    else if (name.endsWith(".teda")) out.push(full);
  }
  return out.sort();
}

interface ComponentEntry {
  file: string;
  id: string;
  symbol: string;
  footprint: string;
  pins: string[];
}

// 1) scan components: resolve symbol/footprint references and pin numbers
const components: ComponentEntry[] = [];
for (const file of listTeda(join(projectRoot, "assets/components"))) {
  const text = readFileSync(file, "utf8");
  const facts = readComponentFacts(text, { file });
  if (!facts.ok || !facts.facts) {
    for (const d of facts.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${file}: component description could not be read`);
    continue;
  }
  const symbol = /^symbol\s+(\S+)$/m.exec(text)?.[1];
  const footprint = /^footprint\s+(\S+)$/m.exec(text)?.[1];
  if (!symbol || !footprint) {
    fail(`${file}: missing symbol or footprint`);
    continue;
  }
  components.push({
    file,
    id: facts.facts.id,
    symbol,
    footprint,
    pins: facts.facts.pins.map((p) => p.number),
  });
}

const parseRef = (ref: string): { lib: string; name: string } | null => {
  const at = ref.indexOf(":");
  if (at <= 0 || at === ref.length - 1) return null;
  return { lib: ref.slice(0, at), name: ref.slice(at + 1) };
};

const symbolDir = join(projectRoot, "assets/symbols", libName);
const footprintDir = join(projectRoot, "assets/footprints", libName);

console.log(`[1] ${components.length} devices (parts and generics)`);
for (const c of components) {
  for (const [kind, ref] of [
    ["symbol", c.symbol],
    ["footprint", c.footprint],
  ] as const) {
    const parsed = parseRef(ref);
    if (!parsed) {
      fail(`${c.id}: ${kind} reference has a bad format: ${ref}`);
      continue;
    }
    if (parsed.lib !== libName) {
      // Every asset the project reads is its own: an imported library is a copy under `assets/`
      // (ADR-0034). A reference into any other library directory is a dangling dependency, and the
      // library-level loop below catches the geometry itself.
      fail(
        `${c.id}: ${kind} points to library ${parsed.lib}, which is not a library directory of this project (imported assets keep the copy's library directory)`,
      );
      continue;
    }
    const dir = kind === "symbol" ? symbolDir : footprintDir;
    if (!existsSync(join(dir, `${parsed.name}.teda`))) {
      fail(`${c.id}: ${kind} points to a nonexistent file ${join(dir, `${parsed.name}.teda`)}`);
    }
  }
}

// 2) symbols: canonical / contract / pin numbers / export / KiCad parsing
const symbolFiles = listTeda(symbolDir);
const symbolUsers = new Map<string, ComponentEntry[]>();
for (const c of components) {
  const parsed = parseRef(c.symbol);
  if (!parsed) continue;
  const list = symbolUsers.get(parsed.name) ?? [];
  list.push(c);
  symbolUsers.set(parsed.name, list);
}

console.log(`[2] ${symbolFiles.length} symbols`);
for (const file of symbolFiles) {
  const name = basename(file, ".teda");
  const source = readFileSync(file, "utf8");
  const formatted = formatSymbol(source, { file, library: libName });
  if (!formatted.ok || formatted.text !== source) {
    for (const d of formatted.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: not in canonical form`);
    continue;
  }
  const parsed = parseSymbol(source, { file, library: libName });
  if (!parsed.ok || !parsed.ir) {
    for (const d of parsed.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: compilation failed`);
    continue;
  }
  const check = validate("symbol", parsed.ir);
  if (!check.ok) {
    fail(`${name}: contract validation failed ${JSON.stringify(check.errors)}`);
    continue;
  }
  writeFileSync(join(work, `${name}.json`), canonicalJson(parsed.ir));

  const users = symbolUsers.get(name);
  if (!users || users.length === 0) {
    fail(`${name}: no component references it (orphan symbol)`);
    continue;
  }
  // The pin number set must be consistent with every component that references it
  const symbolPins = new Set(parsed.ir.symbol.pins.map((p) => p.number));
  for (const user of users) {
    const missing = user.pins.filter((p) => !symbolPins.has(p));
    const extra = [...symbolPins].filter((p) => !user.pins.includes(p));
    if (missing.length > 0) fail(`${name}: pins ${missing.join(",")} of component ${user.id} are not drawn`);
    if (extra.length > 0) fail(`${name}: drawn pins ${extra.join(",")} that component ${user.id} does not have`);
  }

  // Export .kicad_sym (use the first component referencing it to provide pin names/electrical types)
  const facts = readComponentFacts(readFileSync(users[0]!.file, "utf8"), { file: users[0]!.file });
  if (!facts.ok || !facts.facts) {
    fail(`${name}: the referencing component could not be read`);
    continue;
  }
  const libPath = join(work, `${name}.kicad_sym`);
  writeFileSync(libPath, symbolLibrary(parsed.ir.symbol, facts.facts));
  if (useKicad) {
    const upgrade = Bun.spawnSync(["kicad-cli", "sym", "upgrade", "--force", "--output", `${work}/${name}.up.kicad_sym`, libPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (upgrade.exitCode !== 0) fail(`${name}: KiCad parsing failed ${upgrade.stderr.toString().trim()}`);
  }

  // Render with **our own** renderer: no KiCad dependency, no system font dependency (text drawn as paths).
  // The footprint side has KiCad's rendering; this fills in the symbols — the whole library can be reviewed at a glance.
  const doc = renderSymbol(parsed.ir.symbol, {
    pins: facts.facts.pins.map((p) => ({ number: p.number, name: p.name, type: p.type })),
  });
  const problems = validateDoc(doc);
  if (problems.length > 0) fail(`${name}: graphics self-check found ${problems.length} problems: ${problems[0]}`);
  writeFileSync(join(work, "symbol-svg", `${name}.svg`), toSvgText(doc));
}
console.log(`    we rendered ${symbolFiles.length} symbols (symbol-svg/)`);

// 3) footprint: canonical / contract / pad numbers / export / KiCad rendering
const footprintFiles = listTeda(footprintDir);
const footprintUsers = new Map<string, ComponentEntry[]>();
for (const c of components) {
  const parsed = parseRef(c.footprint);
  if (!parsed) continue;
  const list = footprintUsers.get(parsed.name) ?? [];
  list.push(c);
  footprintUsers.set(parsed.name, list);
}

console.log(`[3] ${footprintFiles.length} footprints`);
const inlineBlocks: string[] = [];
let slot = 0;
for (const file of footprintFiles) {
  const name = basename(file, ".teda");
  const source = readFileSync(file, "utf8");
  const formatted = formatFootprint(source, { file, library: libName });
  if (!formatted.ok || formatted.text !== source) {
    for (const d of formatted.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: not in canonical form`);
    continue;
  }
  const parsed = parseFootprint(source, { file, library: libName });
  if (!parsed.ok || !parsed.ir) {
    for (const d of parsed.diagnostics) console.error(`  ${formatDiagnostic(d)}`);
    fail(`${name}: compilation failed`);
    continue;
  }
  const check = validate("footprint", parsed.ir);
  if (!check.ok) {
    fail(`${name}: contract validation failed ${JSON.stringify(check.errors)}`);
    continue;
  }
  const body = parsed.ir.footprint;
  // The land pattern states its package code (ADR-0028 decision 1): the devices on it do not restate it.
  if (!body.package_code) {
    fail(`${name}: no package_code — the land pattern must state its package code`);
    continue;
  }
  writeFileSync(join(work, `${name}.json`), canonicalJson(parsed.ir));
  writeFileSync(join(work, "project.pretty", `${name}.kicad_mod`), footprintModule(body));

  // Render with **our own** renderer and self-check: zero external dependencies, symbols and footprints use the same standard (ADR-0036).
  const fpDoc = renderFootprint(body);
  const fpProblems = validateDoc(fpDoc);
  if (fpProblems.length > 0) fail(`${name}: graphics self-check found ${fpProblems.length} problems: ${fpProblems[0]}`);
  writeFileSync(join(work, "footprint-svg", `${name}.svg`), toSvgText(fpDoc));

  const users = footprintUsers.get(name);
  if (!users || users.length === 0) {
    fail(`${name}: no component references it (orphan footprint)`);
    continue;
  }
  const pads = new Set(body.pads.map((p) => p.number));
  for (const user of users) {
    const missing = user.pins.filter((p) => !pads.has(p));
    if (missing.length > 0) fail(`${name}: no pads for pins ${missing.join(",")} of component ${user.id}`);
    const extra = [...pads].filter((p) => !user.pins.includes(p));
    if (extra.length > 0) console.error(`  ! ${name}: extra pads ${extra.join(",")} (component ${user.id} has no matching pins)`);
  }

  // Arrange into a grid on the board (5 per row, 25mm spacing)
  const x = 25_000_000 * (slot % 5) + 25_000_000;
  const y = 25_000_000 * Math.floor(slot / 5) + 25_000_000;
  inlineBlocks.push(
    footprintInline(body, { xNm: x, yNm: y, reference: `U${slot + 1}`, value: name }),
  );
  slot += 1;
}

if (useKicad) {
  const svg = Bun.spawnSync(["kicad-cli", "fp", "export", "svg", "--output", join(work, "svg"), join(work, "project.pretty")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (svg.exitCode !== 0) fail(`kicad-cli fp export svg failed ${svg.stderr.toString().trim()}`);
  else console.log(`    KiCad rendered ${readdirSync(join(work, "svg")).length} footprints`);
}
console.log(`    we rendered ${footprintFiles.length} footprints (footprint-svg/)`);

// 4) all footprints placed on one board, DRC
const cols = Math.min(5, Math.max(1, slot));
const rows = Math.ceil(slot / 5);
const width = 25_000_000 * cols + 25_000_000;
const height = 25_000_000 * rows + 25_000_000;
const mm = (nm: number): string => (nm / 1_000_000).toFixed(3);
const edge = (x1: number, y1: number, x2: number, y2: number): string =>
  `\t(gr_line (start ${x1} ${y1}) (end ${x2} ${y2}) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))`;
const board = [
  "(kicad_pcb",
  "\t(version 20241229)",
  '\t(generator "TextEDA")',
  "\t(general (thickness 1.6))",
  '\t(paper "A4")',
  "\t(layers",
  '\t\t(0 "F.Cu" signal)', '\t\t(2 "B.Cu" signal)', '\t\t(13 "F.Paste" user)', '\t\t(15 "B.Paste" user)',
  '\t\t(5 "F.SilkS" user "F.Silkscreen")', '\t\t(7 "B.SilkS" user "B.Silkscreen")',
  '\t\t(1 "F.Mask" user)', '\t\t(3 "B.Mask" user)',
  '\t\t(17 "Dwgs.User" user "User.Drawings")', '\t\t(19 "Cmts.User" user "User.Comments")',
  '\t\t(21 "Eco1.User" user "User.Eco1")', '\t\t(23 "Eco2.User" user "User.Eco2")',
  '\t\t(25 "Edge.Cuts" user)', '\t\t(27 "Margin" user)',
  '\t\t(31 "F.CrtYd" user "F.Courtyard")', '\t\t(29 "B.CrtYd" user "B.Courtyard")',
  '\t\t(35 "F.Fab" user)', '\t\t(33 "B.Fab" user)',
  "\t)",
  '\t(net 0 "")',
  ...inlineBlocks,
  edge(0, 0, Number(mm(width)), 0),
  edge(Number(mm(width)), 0, Number(mm(width)), Number(mm(height))),
  edge(Number(mm(width)), Number(mm(height)), 0, Number(mm(height))),
  edge(0, Number(mm(height)), 0, 0),
  ")",
  "",
].join("\n");
const boardPath = join(work, "libs.kicad_pcb");
writeFileSync(boardPath, board);
writeFileSync(
  join(work, "fp-lib-table"),
  `(fp_lib_table\n  (lib (name "${libName}")(type "KiCad")(uri "\${KIPRJMOD}/project.pretty")(options "")(descr ""))\n)\n`,
);
const drcPath = join(work, "drc.json");
if (useKicad) {
  const drc = Bun.spawnSync([
    "kicad-cli", "pcb", "drc", "--severity-all", "--format", "json", "--output", drcPath, boardPath,
  ], { stdout: "pipe", stderr: "pipe" });
  if (drc.exitCode !== 0) {
    fail(`kicad-cli pcb drc failed ${drc.stderr.toString().trim()}`);
  } else {
    const report = JSON.parse(readFileSync(drcPath, "utf8")) as {
      violations: { type?: string; description?: string }[];
    };
    console.log(`[4] merged board DRC: violations=${report.violations.length}`);
    for (const v of report.violations) fail(`DRC ${v.type ?? "?"}: ${v.description ?? ""}`);
  }
} else {
  console.log("[4] merged board DRC: skipped (--kicad not enabled; merged board file generated for interoperability verification)");
}

// 5) summary
if (problems.length > 0) {
  console.error(`\n${problems.length} failures`);
  process.exit(1);
}
console.log(
  `\npassed: ${components.length} components / ${symbolFiles.length} symbols / ${footprintFiles.length} footprints` +
  ` (${useKicad ? "including KiCad interoperability section" : "zero-dependency required section"})`,
);
console.log(`artifacts in ${work}`);
