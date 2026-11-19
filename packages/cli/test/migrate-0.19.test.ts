import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(repoRoot, "scripts", "migrate-0.19.ts");
const projects: string[] = [];

function project(mainText: string): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-migrate-0.19-"));
  projects.push(root);
  mkdirSync(join(root, "design", "sch"), { recursive: true });
  mkdirSync(join(root, "assets", "components"), { recursive: true });
  writeFileSync(join(root, "project.toml"), '[project]\nname = "migration-test"\nformat = "0.18"\n');
  writeFileSync(join(root, "design", "sch", "main.teda"), mainText);
  writeFileSync(join(root, "assets", "components", "sample.teda"), "version 0.1.0\ncomponent sample\n");
  return root;
}

afterEach(() => {
  for (const root of projects.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(root: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, root], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const schematic = (subject = "VBUS"): string => `version 0.18.0
schematic main

modules
  M1  sample

nets
  VBUS:  M1.PORT

constraints
  current  ${subject}  3.00A
  current  M1.U1.1  500mA
`;

describe("migration to language 0.19", () => {
  test("keeps pin current, converts a recognized net current to TODO and bumps headers", () => {
    const root = project(schematic());
    const result = run(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no PCB current rule was inferred");
    const output = readFileSync(join(root, "design/sch/main.teda"), "utf8");
    expect(output).toContain("version 0.19.0");
    expect(output).toContain("# TODO(F88): review rail VBUS maximum current 3.00A");
    expect(output).toContain("  current  M1.U1.1  500mA");
    expect(output).not.toContain("\n  current  VBUS  3.00A");
    expect(readFileSync(join(root, "assets/components/sample.teda"), "utf8")).toContain("version 0.19.0");
    expect(readFileSync(join(root, "project.toml"), "utf8")).toContain('format = "0.19"');
  });

  test("recognizes accepted plain, trailing-colon and split-colon net rows", () => {
    const text = schematic()
      .replace("  VBUS:  M1.PORT", "  VBUS  M1.PORT\n  VOUT:  M1.PORT2\n  V3V3  :  M1.PORT3")
      .replace(
        "  current  VBUS  3.00A\n  current  M1.U1.1  500mA",
        "  current  VBUS  3.00A\n  current  VOUT  2A\n  current  V3V3  300mA\n  current  M1.U1.1  500mA",
      );
    const root = project(text);
    const result = run(root);
    expect(result.code).toBe(0);
    const output = readFileSync(join(root, "design/sch/main.teda"), "utf8");
    expect(output).toContain("# TODO(F88): review rail VBUS maximum current 3.00A");
    expect(output).toContain("# TODO(F88): review rail VOUT maximum current 2A");
    expect(output).toContain("# TODO(F88): review rail V3V3 maximum current 300mA");
    expect(output).toContain("  current  M1.U1.1  500mA");
  });

  test("recognizes bus-member nets even when their ids resemble a pin reference", () => {
    const root = project(schematic());
    const modulePath = join(root, "design/sch/modules/sample.teda");
    mkdirSync(join(root, "design/sch/modules"), { recursive: true });
    writeFileSync(modulePath, `version 0.18.0
module sample

instances
  U1  sample

bus U1 = power
  1:  U1.1

constraints
  current  U1.1  2A
`);
    const result = run(root);
    expect(result.code).toBe(0);
    const output = readFileSync(modulePath, "utf8");
    expect(output).toContain("# TODO(F88): review rail U1.1 maximum current 2A");
    expect(output).not.toContain("  current  U1.1  2A");
  });

  test("refuses duplicate bus declarations before writing other project files", () => {
    const root = project(schematic());
    const modulePath = join(root, "design/sch/modules/sample.teda");
    mkdirSync(join(root, "design/sch/modules"), { recursive: true });
    const moduleText = `version 0.18.0\nmodule sample\n\nbus U1 = power\n  1:  U1.1\nbus U1 = signal\n  2:  U1.2\n\nconstraints\n  current  U1.1  2A\n`;
    writeFileSync(modulePath, moduleText);
    const mainPath = join(root, "design/sch/main.teda");
    const assetPath = join(root, "assets/components/sample.teda");
    const projectPath = join(root, "project.toml");
    const originalMain = readFileSync(mainPath, "utf8");
    const originalAsset = readFileSync(assetPath, "utf8");
    const originalProject = readFileSync(projectPath, "utf8");
    const result = run(root);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("duplicate bus declaration 'U1'");
    expect(readFileSync(mainPath, "utf8")).toBe(originalMain);
    expect(readFileSync(assetPath, "utf8")).toBe(originalAsset);
    expect(readFileSync(projectPath, "utf8")).toBe(originalProject);
    expect(readFileSync(modulePath, "utf8")).toBe(moduleText);
  });

  test("refuses an unresolved current subject without writing any files", () => {
    const root = project(schematic("POWER_RAIL"));
    const originalMain = readFileSync(join(root, "design/sch/main.teda"), "utf8");
    const originalAsset = readFileSync(join(root, "assets/components/sample.teda"), "utf8");
    const originalProject = readFileSync(join(root, "project.toml"), "utf8");
    const result = run(root);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("cannot resolve current subject 'POWER_RAIL'");
    expect(result.stderr).toContain("No project files were changed.");
    expect(readFileSync(join(root, "design/sch/main.teda"), "utf8")).toBe(originalMain);
    expect(readFileSync(join(root, "assets/components/sample.teda"), "utf8")).toBe(originalAsset);
    expect(readFileSync(join(root, "project.toml"), "utf8")).toBe(originalProject);
    expect(existsSync(join(root, ".migrate-0.19-"))).toBe(false);
  });

  test("refuses malformed current rows, values and net ids without writing", () => {
    const malformed = project(schematic().replace("current  VBUS  3.00A", "current  VBUS"));
    const malformedResult = run(malformed);
    expect(malformedResult.code).not.toBe(0);
    expect(malformedResult.stderr).toContain("expected exactly 'current <subject> <max>'");
    expect(readFileSync(join(malformed, "design/sch/main.teda"), "utf8")).toContain("version 0.18.0");

    const invalidValue = project(schematic().replace("current  VBUS  3.00A", "current  VBUS  nonsense"));
    const originalMain = readFileSync(join(invalidValue, "design/sch/main.teda"), "utf8");
    const originalAsset = readFileSync(join(invalidValue, "assets/components/sample.teda"), "utf8");
    const originalProject = readFileSync(join(invalidValue, "project.toml"), "utf8");
    const invalidValueResult = run(invalidValue);
    expect(invalidValueResult.code).not.toBe(0);
    expect(invalidValueResult.stderr).toContain("cannot safely migrate invalid current maximum 'nonsense'");
    expect(readFileSync(join(invalidValue, "design/sch/main.teda"), "utf8")).toBe(originalMain);
    expect(readFileSync(join(invalidValue, "assets/components/sample.teda"), "utf8")).toBe(originalAsset);
    expect(readFileSync(join(invalidValue, "project.toml"), "utf8")).toBe(originalProject);

    const ambiguous = project(schematic("R1.1").replace("  VBUS:  M1.PORT", "  VBUS:  M1.PORT\n  R1.1:  M1.U1.1"));
    const ambiguousResult = run(ambiguous);
    expect(ambiguousResult.code).not.toBe(0);
    expect(ambiguousResult.stderr).toContain("cannot safely identify a net row in the nets section");
    expect(readFileSync(join(ambiguous, "design/sch/main.teda"), "utf8")).toContain("version 0.18.0");
  });
});
