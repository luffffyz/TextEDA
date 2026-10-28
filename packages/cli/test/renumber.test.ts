// `texteda renumber`: one mapping, every reference, an atomic apply (ADR-0110).
//
// The command is exercised through the CLI because flags, dry-run/apply and output are part of its
// contract. Small pure checks cover the formatter boundary and the `project.toml` variant scanner.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSchematic } from "@texteda/parser";
import { type RenumberReport, editProjectVariants } from "../src/renumber.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const reference = join(repoRoot, "examples", "reference-project");
const multiUnit = join(repoRoot, "examples", "cases", "dual-opamp-multi-unit");
const busCase = join(repoRoot, "examples", "cases", "bus");
const script = join(import.meta.dir, "../scripts/texteda.ts");
const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

function copyProject(source: string): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-renumber-"));
  temporary.push(root);
  for (const dir of ["assets", "design", "views", "docs"]) {
    const from = join(source, dir);
    if (existsSync(from)) cpSync(from, join(root, dir), { recursive: true });
  }
  const project = join(source, "project.toml");
  if (existsSync(project)) cpSync(project, join(root, "project.toml"));
  return root;
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function mappingFile(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-map-"));
  temporary.push(dir);
  const path = join(dir, "map.txt");
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function instanceRows(text: string): string[][] {
  const rows: string[][] = [];
  let inInstances = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "instances") {
      inInstances = true;
      continue;
    }
    if (inInstances && trimmed === "") continue;
    if (inInstances && trimmed !== "" && !line.startsWith("  ")) break;
    if (inInstances && trimmed !== "") rows.push(trimmed.split(/\s+/));
  }
  return rows;
}

describe("renumber mapping and references", () => {
  test("a dry run reports the mapping and hashes but writes nothing", () => {
    const root = copyProject(reference);
    const before = read(join(root, "design/modules/buck-5v.teda"));
    const map = mappingFile(["buck-5v/C1 C9"]);
    const result = run(["renumber", root, "charger-buck", "--mapping", map]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("buck-5v/C1 -> C9");
    expect(result.stdout).toContain("Project hash:");
    expect(result.stdout).toContain("dry run");
    const hashes = /Project hash: ([0-9a-f]+) -> ([0-9a-f]+)/.exec(result.stdout);
    expect(hashes).not.toBeNull();
    expect(hashes![1]).not.toBe(hashes![2]);
    expect(result.stdout).toContain("Markdown still mentions old names");
    expect(read(join(root, "design/modules/buck-5v.teda"))).toBe(before);
  });

  test("a module mapping updates the module source, the view and the pcb, and leaves other modules alone", () => {
    const root = copyProject(reference);
    const other = read(join(root, "design/modules/charger-power.teda"));
    const result = run([
      "renumber",
      root,
      "charger-buck",
      "--mapping",
      mappingFile(["buck-5v/C1 C9"]),
      "--apply",
    ]);
    expect(result.code).toBe(0);
    const source = read(join(root, "design/modules/buck-5v.teda"));
    expect(instanceRows(source).map((row) => row[0])).toContain("C9");
    expect(instanceRows(source).map((row) => row[0])).not.toContain("C1");
    expect(read(join(root, "design/modules/charger-power.teda"))).toBe(other);
    expect(read(join(root, "views/charger-buck/buck-5v.view.teda"))).toContain("M2.C9");
    expect(read(join(root, "design/pcb/charger-buck.teda"))).toContain("M2.C9");
  });

  test("compact closes the gap left by a mapping", () => {
    const root = copyProject(reference);
    expect(run(["renumber", root, "mcu-board", "--mapping", mappingFile(["R1 R5"]), "--apply"]).code).toBe(0);
    const compact = run(["renumber", root, "mcu-board", "--policy", "compact", "--apply"]);
    expect(compact.code).toBe(0);
    expect(compact.stdout).toContain("R2 -> R1");
    expect(compact.stdout).toContain("R5 -> R3");
    const rows = instanceRows(read(join(root, "design/sch/mcu-board.teda"))).map((row) => row[0]);
    expect(rows.filter((row) => /^R[0-9]+$/.test(row ?? ""))).toEqual(["R1", "R2", "R3"]);
  });

  test("preserve keeps the existing numbers", () => {
    const root = copyProject(reference);
    const before = read(join(root, "design/sch/mcu-board.teda"));
    const result = run(["renumber", root, "mcu-board", "--policy", "preserve", "--apply"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("No changes.");
    expect(read(join(root, "design/sch/mcu-board.teda"))).toBe(before);
  });

  test("position follows the view from top to bottom, then left to right", () => {
    const root = copyProject(reference);
    mkdirSync(join(root, "views", "mcu-board"), { recursive: true });
    writeFileSync(
      join(root, "views", "mcu-board", "main.view.teda"),
      [
        "version 0.7",
        "view main",
        "",
        "place",
        "  C1  20  0  0",
        "  R1  0   20 0",
        "  R2  0   0  0",
        "  R3  10  10 0",
        "",
      ].join("\n"),
    );
    const result = run(["renumber", root, "mcu-board", "--policy", "position", "--apply"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("R2 -> R1");
    expect(result.stdout).toContain("R1 -> R3");
    const rows = instanceRows(read(join(root, "design/sch/mcu-board.teda")));
    expect(rows.find((row) => row[0] === "R1")?.[1]).toBe("IDf069y5"); // the instance that was R2
    expect(rows.find((row) => row[0] === "R3")?.[1]).toBe("ID0gm2vz"); // the instance that was R1
  });

  test("position refuses to guess when there is no view", () => {
    const root = copyProject(reference);
    const before = read(join(root, "design/sch/mcu-board.teda"));
    const result = run(["renumber", root, "mcu-board", "--policy", "position"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("no print page placement");
    expect(read(join(root, "design/sch/mcu-board.teda"))).toBe(before);
  });

  test("position refuses an instance placed at two different coordinates", () => {
    const root = copyProject(reference);
    mkdirSync(join(root, "views", "mcu-board"), { recursive: true });
    writeFileSync(
      join(root, "views", "mcu-board", "main.view.teda"),
      ["version 0.7", "view main", "", "place", "  R1  0 0 0", "  R1  10 10 0", ""].join("\n"),
    );
    const result = run(["renumber", root, "mcu-board", "--policy", "position"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("mcu-board/R1");
    expect(result.stderr).toContain("ambiguous");
  });

  test("the CLI rejects conflicting flags", () => {
    const root = copyProject(reference);
    expect(run(["renumber", root, "mcu-board", "--apply", "--dry-run"]).code).toBe(2);
    expect(run(["renumber", root, "mcu-board", "--policy", "compact", "--mapping", mappingFile(["R1 R5"])]).code).toBe(2);
    expect(run(["renumber", root, "mcu-board", "--policy", "mapping"]).code).toBe(2);
  });

  test("a directory as the mapping file is a diagnostic, not a stack trace", () => {
    const root = copyProject(reference);
    const result = run(["renumber", root, "mcu-board", "--mapping", root]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cannot read mapping file");
    expect(result.stderr).not.toContain("EISDIR");
  });

  test("a collision or a prefix change is rejected before any write", () => {
    const root = copyProject(reference);
    const before = read(join(root, "design/sch/mcu-board.teda"));
    const collision = run(["renumber", root, "mcu-board", "--mapping", mappingFile(["R1 R2"]), "--apply"]);
    expect(collision.code).toBe(1);
    expect(collision.stderr).toContain("would be assigned to both R1 and R2");
    expect(read(join(root, "design/sch/mcu-board.teda"))).toBe(before);

    const prefix = run(["renumber", root, "mcu-board", "--mapping", mappingFile(["R1 C1"]), "--apply"]);
    expect(prefix.code).toBe(1);
    expect(prefix.stderr).toContain("changes the prefix");
    expect(read(join(root, "design/sch/mcu-board.teda"))).toBe(before);
  });

  test("constraint pin subjects follow the rename", () => {
    const root = copyProject(reference);
    const boardFile = join(root, "design/sch/mcu-board.teda");
    writeFileSync(
      boardFile,
      read(boardFile).replace("constraints\n", "constraints\n  power    R1.1    2mW\n"),
    );
    const result = run(["renumber", root, "mcu-board", "--mapping", mappingFile(["R1 R9"]), "--apply"]);
    expect(result.code).toBe(0);
    const source = read(boardFile);
    expect(source).toMatch(/power\s+R9\.1\s+2mW/);
    expect(source).not.toMatch(/power\s+R1\.1\s+2mW/);
  });

  test("module constraint pin subjects follow the local rename", () => {
    const root = copyProject(reference);
    const moduleFile = join(root, "design/modules/buck-5v.teda");
    writeFileSync(
      moduleFile,
      read(moduleFile).replace("constraints\n  voltage  VFB", "constraints\n  current  R1.1    1mA\n  voltage  VFB"),
    );
    const result = run([
      "renumber",
      root,
      "charger-buck",
      "--mapping",
      mappingFile(["buck-5v/R1 R7"]),
      "--apply",
    ]);
    expect(result.code).toBe(0);
    const source = read(moduleFile);
    expect(source).toMatch(/current\s+R7\.1\s+1mA/);
    expect(source).not.toMatch(/current\s+R1\.1\s+1mA/);
  });

  test("a module port reference is not an instance reference", () => {
    const root = copyProject(reference);
    rmSync(join(root, "views"), { recursive: true, force: true });
    rmSync(join(root, "design/pcb"), { recursive: true, force: true });
    const moduleFile = join(root, "design/modules/buck-5v.teda");
    writeFileSync(
      moduleFile,
      read(moduleFile).replace("ports\n  GND     GND", "ports\n  C1      BOOT\n  GND     GND"),
    );
    const boardFile = join(root, "design/sch/charger-buck.teda");
    writeFileSync(
      boardFile,
      read(boardFile).replace("\nports\n", "\n  TAP:  M2.C1\n\nports\n"),
    );
    const result = run([
      "renumber",
      root,
      "charger-buck",
      "--mapping",
      mappingFile(["buck-5v/C1 C9"]),
      "--apply",
    ]);
    expect(result.code).toBe(0);
    const board = read(boardFile);
    expect(board).toMatch(/TAP:\s+M2\.C1/);
    expect(board).not.toMatch(/TAP:\s+M2\.C9/);
    expect(read(moduleFile)).toMatch(/^  C9\s/m);
  });

  test("multi-unit and pin references are rewritten", () => {
    const root = copyProject(multiUnit);
    const result = run([
      "renumber",
      root,
      "multi-unit",
      "--mapping",
      mappingFile(["R1 R3", "U1 U2"]),
      "--apply",
    ]);
    expect(result.code).toBe(0);
    const source = read(join(root, "design/sch/multi-unit.teda"));
    const machine = source.replace(/^#.*$/gm, "");
    expect(machine).toContain("R3.2");
    expect(machine).toContain("U2.2.OUT");
    expect(machine).not.toContain("U1.2.OUT");
    expect(machine).not.toContain("R1.2");
  });

  test("view wire net names do not follow an instance rename", () => {
    const root = copyProject(reference);
    const result = run([
      "renumber",
      root,
      "charger-buck",
      "--mapping",
      mappingFile(["buck-5v/U1 U5"]),
      "--apply",
    ]);
    expect(result.code).toBe(0);
    const view = read(join(root, "views/charger-buck/buck-5v.view.teda"));
    expect(view).toContain("M2.U5.1");
    expect(view).toContain("M2.BOOT");
    expect(view).not.toContain("M2.U1.1");
  });

  test("bus members follow the rename while bus and net names stay", () => {
    const root = copyProject(busCase);
    const result = run(["renumber", root, "sensor-hub", "--mapping", mappingFile(["J1 J20"]), "--apply"]);
    expect(result.code).toBe(0);
    const source = read(join(root, "design/sch/sensor-hub.teda"));
    expect(source).toContain("J20.1");
    expect(source).not.toMatch(/\bJ1\./);
    expect(source).toContain("bus pwr = PWR");
    expect(source).toContain("gnd:");
  });

  test("a second apply of the same mapping is a no-op", () => {
    const root = copyProject(reference);
    const map = mappingFile(["buck-5v/C1 C9"]);
    expect(run(["renumber", root, "charger-buck", "--mapping", map, "--apply"]).code).toBe(0);
    const afterFirst = read(join(root, "design/modules/buck-5v.teda"));
    const second = run(["renumber", root, "charger-buck", "--mapping", map, "--apply"]);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("No changes.");
    expect(read(join(root, "design/modules/buck-5v.teda"))).toBe(afterFirst);
  });
});

describe("renumber boundaries", () => {
  test("variant values are renamed, but a variant description is prose", () => {
    const text = [
      "[variants.lite]",
      'description = "R1 stays as documentation"',
      'dnp = ["R1", "comp_c7"]',
      'nofit = ["R2"]',
      'from = "R1"',
      'to = "R2"',
      'dnp = [',
      '  "R1",',
      '  "R2",',
      ']',
      "",
    ].join("\n");
    const result = editProjectVariants(text, new Map([["R1", "R3"], ["R2", "R4"]]));
    expect(result.text).toContain('description = "R1 stays as documentation"');
    expect(result.text).toContain('dnp = ["R3", "comp_c7"]');
    expect(result.text).toContain('nofit = ["R4"]');
    expect(result.text).toContain('from = "R3"');
    expect(result.text).toContain('to = "R4"');
    expect(result.text).toContain('  "R3",');
    expect(result.text).toContain('  "R4",');
  });

  test("fmt never renumbers, even when the rows have a gap", () => {
    const source = [
      "version 0.9",
      "schematic b",
      "",
      "instances",
      "  R1  ID000001  res 10k",
      "  R2  ID000002  res 10k",
      "  R5  ID000003  res 10k",
      "",
    ].join("\n");
    const result = formatSchematic(source, { file: "design/sch/b.teda" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("R1");
    expect(result.text).toContain("R2");
    expect(result.text).toContain("R5");
    expect(result.text).not.toContain("R3");
  });
});
describe("renumber markdown scoping and io errors", () => {
  test("bare board refdes are only reported in board-owned markdown", () => {
    const root = copyProject(reference);
    const map = mappingFile(["R1 R9"]);
    const result = run(["renumber", root, "mcu-board", "--json", "--mapping", map]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as RenumberReport;
    const bare = report.markdown.filter((hit) => hit.old === "R1");
    expect(bare.length).toBeGreaterThan(0);
    expect(bare.every((hit) => /mcu-board-components|mcu-board-sch-r1/.test(hit.file))).toBe(true);
    expect(bare.every((hit) => !/charger-buck|README\.md/.test(hit.file))).toBe(true);
  });

  test("module-qualified refdes are still reported in charger-buck docs", () => {
    const root = copyProject(reference);
    const map = mappingFile(["buck-5v/C1 C9"]);
    const result = run(["renumber", root, "charger-buck", "--json", "--mapping", map]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as RenumberReport;
    const qualified = report.markdown.filter((hit) => hit.old === "M2.C1");
    expect(qualified.length).toBeGreaterThan(0);
    expect(qualified.some((hit) => hit.file.includes("charger-buck"))).toBe(true);
  });

  test("an unwritable directory is an actionable renumber error, not a stack trace", () => {
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const root = copyProject(reference);
    chmodSync(join(root, "views", "charger-buck"), 0o555);
    const result = run(["renumber", root, "charger-buck", "--mapping", mappingFile(["buck-5v/U1 U5"]), "--apply"]);
    chmodSync(join(root, "views", "charger-buck"), 0o755);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("renumber: cannot write the renumbered sources");
    expect(result.stderr).toContain(root);
  });
});
