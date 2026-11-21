#!/usr/bin/env bun
// End-to-end verification of docs/skills/new-project.md.
//
// The smoke starts with `texteda init`, adds a small buck-converter project from the repository's
// authored library assets, and exercises every endpoint that the skill currently promises. It
// deliberately leaves its temporary directory behind so a failed run can be inspected.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const fixture = join(repo, "examples/reference-project");
const bun = process.execPath;

type CommandResult = { exitCode: number; stdout: string; stderr: string };

function run(command: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync({ cmd: command, cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function runRequired(label: string, command: string[], cwd: string): CommandResult {
  const result = run(command, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed with exit code ${result.exitCode}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function writeProjectFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function assertFile(path: string): void {
  if (!existsSync(path)) throw new Error(`expected output does not exist: ${path}`);
}

function filesUnder(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path));
    }
  };
  visit(root);
  return files.sort();
}

function assertSameFiles(left: string, right: string): void {
  const leftFiles = filesUnder(left);
  const rightFiles = filesUnder(right);
  if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) {
    throw new Error(`output file sets differ:\n${leftFiles.join("\n")}\n---\n${rightFiles.join("\n")}`);
  }
  for (const file of leftFiles) {
    const a = readFileSync(join(left, file));
    const b = readFileSync(join(right, file));
    if (!a.equals(b)) throw new Error(`output is not byte-reproducible: ${file}`);
  }
}

export function runSkillNewProject(): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-new-project-"));
  const dist = join(root, "dist");
  const script = (path: string): string => join(repo, path);

  runRequired("init", [bun, "run", "texteda", "init", root, "--name", "skill-demo"], repo);

  // Reuse only authored library descriptions; the project tree itself is created by init and the
  // logical/physical descriptions below are written by this smoke. This keeps the test focused on
  // the documented workflow rather than duplicating the library format in a second fixture.
  for (const kind of ["components", "symbols", "footprints"] as const) {
    cpSync(join(fixture, "assets", kind), join(root, "assets", kind), { recursive: true });
  }
  cpSync(
    join(fixture, "design/sch/modules/buck-5v.teda"),
    join(root, "design/sch/modules/buck-5v.teda"),
  );
  writeProjectFile(
    root,
    "design/sch/main.teda",
    `version 0.19.0\nschematic main\n\nmodules\n  M1  ID7k3m9q  buck-5v\n\nnets\n  GND:   M1.GND\n  SYS:   M1.SYS_IN\n  VOUT:  M1.VOUT\n\nports\n  GND      GND\n  DC_IN    SYS\n  VOUT_5V  VOUT\n\nconstraints\n  voltage  GND   0V..0V\n  voltage  SYS   9V..19V\n  voltage  VOUT  4.5V..5.5V\n`,
  );

  const pcb = readFileSync(join(fixture, "design/pcb/charger-buck.teda"), "utf8")
    .replace("modules\n  M1\n  M2", "modules\n  M1")
    .replaceAll("M2.", "M1.")
    .replace("pcb charger-buck", "pcb demo");
  writeProjectFile(root, "design/pcb/demo.teda", pcb);
  writeProjectFile(
    root,
    "assets/procurement/primary/demo.teda",
    "version 0.19.0\nprocurement demo\nrole primary\n\nselections\n",
  );

  const cli = (...args: string[]): CommandResult =>
    runRequired(`texteda ${args.join(" ")}`, [bun, "run", "texteda", ...args], repo);
  const project = root;

  const check = cli("check", project, "--json");
  const checkPayload = JSON.parse(check.stdout) as { errorCount: number };
  if (checkPayload.errorCount !== 0) {
    throw new Error(`skill project has ${checkPayload.errorCount} check errors:\n${check.stdout}`);
  }

  cli("compile", project, "demo", "--out", join(dist, "schematic-a.json"));
  cli("compile", project, "demo", "--out", join(dist, "schematic-b.json"));
  cli("netlist", project, "--out", join(dist, "netlist-a.txt"));
  cli("netlist", project, "--out", join(dist, "netlist-b.txt"));
  cli("bom", project, "demo", "--out", join(dist, "bom-a.csv"));
  cli("bom", project, "demo", "--out", join(dist, "bom-b.csv"));

  const symbol = "assets/symbols/passives/c.teda";
  const component = "assets/components/passives/cap-mlcc-0402.teda";
  const footprint = "assets/footprints/chip/chip-0402.teda";
  runRequired(
    "compile symbol a",
    [bun, "run", script("packages/parser/scripts/compile-symbol.ts"), symbol, "--out", "dist/symbol-a.json"],
    project,
  );
  runRequired(
    "compile symbol b",
    [bun, "run", script("packages/parser/scripts/compile-symbol.ts"), symbol, "--out", "dist/symbol-b.json"],
    project,
  );
  runRequired(
    "export symbol a",
    [bun, "run", script("scripts/export-symbol.ts"), "dist/symbol-a.json", "--component", component, "--out", "dist/symbol-a.kicad_sym"],
    project,
  );
  runRequired(
    "export symbol b",
    [bun, "run", script("scripts/export-symbol.ts"), "dist/symbol-b.json", "--component", component, "--out", "dist/symbol-b.kicad_sym"],
    project,
  );
  runRequired(
    "compile footprint a",
    [bun, "run", script("packages/parser/scripts/compile-footprint.ts"), footprint, "--out", "dist/footprint-a.json"],
    project,
  );
  runRequired(
    "compile footprint b",
    [bun, "run", script("packages/parser/scripts/compile-footprint.ts"), footprint, "--out", "dist/footprint-b.json"],
    project,
  );
  runRequired(
    "export footprint a",
    [bun, "run", script("packages/exporter/scripts/export-footprint.ts"), "dist/footprint-a.json", "--out", "dist/fp-a"],
    project,
  );
  runRequired(
    "export footprint b",
    [bun, "run", script("packages/exporter/scripts/export-footprint.ts"), "dist/footprint-b.json", "--out", "dist/fp-b"],
    project,
  );
  cli("export", "gerbers", project, "demo", "--out", join(dist, "gerbers-a"));
  cli("export", "gerbers", project, "demo", "--out", join(dist, "gerbers-b"));

  for (const path of [
    "schematic-a.json",
    "schematic-b.json",
    "netlist-a.txt",
    "netlist-b.txt",
    "bom-a.csv",
    "bom-b.csv",
    "symbol-a.kicad_sym",
    "symbol-b.kicad_sym",
    "footprint-a.json",
    "footprint-b.json",
    "fp-a/chip-0402.kicad_mod",
    "fp-b/chip-0402.kicad_mod",
  ]) assertFile(join(dist, path));
  assertSameFiles(join(dist, "gerbers-a"), join(dist, "gerbers-b"));
  assertSameFiles(join(dist, "fp-a"), join(dist, "fp-b"));
  for (const [a, b] of [
    ["schematic-a.json", "schematic-b.json"],
    ["netlist-a.txt", "netlist-b.txt"],
    ["bom-a.csv", "bom-b.csv"],
    ["symbol-a.kicad_sym", "symbol-b.kicad_sym"],
    ["footprint-a.json", "footprint-b.json"],
  ] as const) {
    if (!readFileSync(join(dist, a)).equals(readFileSync(join(dist, b)))) {
      throw new Error(`output is not byte-reproducible: ${a} vs ${b}`);
    }
  }

  return root;
}

if (import.meta.main) {
  const root = runSkillNewProject();
  console.log(`skill:new-project passed (temporary project: ${root})`);
}
