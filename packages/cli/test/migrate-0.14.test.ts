import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(repoRoot, "scripts", "migrate-0.14.ts");
const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-migrate-0.14-"));
  projects.push(root);
  mkdirSync(join(root, "design", "sch"), { recursive: true });
  mkdirSync(join(root, "design", "modules"), { recursive: true });
  mkdirSync(join(root, "design", "pcb"), { recursive: true });
  mkdirSync(join(root, "design", "system"), { recursive: true });
  writeFileSync(join(root, "project.toml"), '[project]\nname = "migration-test"\nformat = "0.13"\n');
  return root;
}

function run(root: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, root], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function put(root: string, path: string, text: string): void {
  const target = join(root, path);
  mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  writeFileSync(target, text);
}

const moduleSource = `version 0.13.0
module connector

ports
  LINK  N
`;

function boardRoot(id: string, modules: string[], members: string[], port: string): string {
  return `version 0.13.0
schematic ${id}

modules
${modules.map((module) => `  ${module}  connector`).join("\n")}

nets
  N:  ${members.join("  ")}

ports
  ${port}  N
`;
}

function oldPcb(id: string): string {
  return `version 0.13.0
pcb ${id}
`;
}

describe("migration to language 0.14", () => {
  test("refuses an unresolved module id without writing any project files", () => {
    const root = project();
    const source = boardRoot("demo", ["M1"], ["M1.LINK"], "EXTERNAL");
    put(root, "design/sch/demo.teda", source);
    put(root, "design/pcb/demo.teda", oldPcb("demo"));
    const beforeFormat = readFileSync(join(root, "project.toml"), "utf8");

    const result = run(root);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("cannot read source");
    expect(result.stderr).toContain("No project files were changed.");
    expect(readFileSync(join(root, "project.toml"), "utf8")).toBe(beforeFormat);
    expect(readFileSync(join(root, "design/sch/demo.teda"), "utf8")).toBe(source);
    expect(existsSync(join(root, "design/sch/main.teda"))).toBe(false);
    expect(existsSync(join(root, "design/pcb/demo.teda"))).toBe(true);
  });

  test("refuses to infer PCB ownership when the matching physical PCB is missing", () => {
    const root = project();
    const source = boardRoot("demo", ["M1"], ["M1.LINK"], "EXTERNAL");
    put(root, "design/sch/demo.teda", source);
    put(root, "design/modules/connector.teda", moduleSource);

    const result = run(root);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("assign this board's modules to a PCB explicitly");
    expect(result.stderr).toContain("No project files were changed.");
    expect(readFileSync(join(root, "project.toml"), "utf8")).toContain('format = "0.13"');
    expect(readFileSync(join(root, "design/sch/demo.teda"), "utf8")).toBe(source);
    expect(existsSync(join(root, "design/sch/main.teda"))).toBe(false);
  });

  test("refuses ambiguous connector endpoints instead of guessing a cable-pin mapping", () => {
    const root = project();
    put(root, "design/modules/connector.teda", moduleSource);
    const first = boardRoot("left", ["M1", "M2"], ["M1.LINK", "M2.LINK"], "LEFT");
    const second = boardRoot("right", ["M3"], ["M3.LINK"], "RIGHT");
    put(root, "design/sch/left.teda", first);
    put(root, "design/sch/right.teda", second);
    put(root, "design/pcb/left.teda", oldPcb("left"));
    put(root, "design/pcb/right.teda", oldPcb("right"));
    put(root, "design/system/product.teda", `version 0.13.0
system product

boards
  left
  right

nets
  LINK:  left.LEFT  right.RIGHT
`);

    const result = run(root);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("resolves to 2 module-port endpoints");
    expect(result.stderr).toContain("No project files were changed.");
    expect(readFileSync(join(root, "design/sch/left.teda"), "utf8")).toBe(first);
    expect(readFileSync(join(root, "design/sch/right.teda"), "utf8")).toBe(second);
    expect(existsSync(join(root, "design/sch/main.teda"))).toBe(false);
    expect(existsSync(join(root, "design/system/product.teda"))).toBe(true);
  });
});
