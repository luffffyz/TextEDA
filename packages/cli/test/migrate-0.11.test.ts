import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(repoRoot, "scripts", "migrate-0.11.ts");
const projects: string[] = [];

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-migrate-0.11-"));
  projects.push(dir);
  const put = (path: string, text: string): void => {
    const file = join(dir, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  };
  put("project.toml", '[project]\nname = "tuple-migration"\nformat = "0.9.2"\n');
  put("views/demo/page.view.teda", "version 0.9.2\nview page\nsheet 297 210\n\nplace\n  U1 10 20\n");
  put("design/pcb/demo.pcb.teda", "version 0.9.2\npcb demo\n\noutline\n  0 0 10 0 10 10\n");
  put("assets/symbols/demo.symbol.teda", "version 0.9.2\nsymbol demo\n\npins\n  1 1 2\n\nbody\n  rect -1,-1,1,1\n");
  put("assets/footprints/demo.footprint.teda", "version 0.9.2\nfootprint demo\n\npads\n  1 smd roundrect -0.95 0.95 1.1 0.6\n");
  put("design/sch/demo.sch.teda", "version 0.1\nschematic demo\n");
  put("assets/components/demo.teda", "version 0.1\ncomponent demo\n");
  return dir;
}

function migrate(dir: string): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", "run", script, dir], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

afterAll(() => {
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("migration 0.10 -> 0.11", () => {
  test("folds geometric tuples once and leaves other description versions untouched", () => {
    const dir = project();
    const first = migrate(dir);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe("");

    const expected = new Map([
      ["project.toml", 'format = "0.11"'],
      ["views/demo/page.view.teda", "U1 [10,20]"],
      ["design/pcb/demo.pcb.teda", "[0,0] [10,0] [10,10]"],
      ["assets/symbols/demo.symbol.teda", "1 [1,2]"],
      ["assets/symbols/demo.symbol.teda", "rect [-1,-1,1,1]"],
      ["assets/footprints/demo.footprint.teda", "1 smd roundrect [-0.95,0.95] [1.1,0.6]"],
    ]);
    for (const [path, snippet] of expected) expect(readFileSync(join(dir, path), "utf8")).toContain(snippet);
    for (const path of [
      "views/demo/page.view.teda",
      "design/pcb/demo.pcb.teda",
      "assets/symbols/demo.symbol.teda",
      "assets/footprints/demo.footprint.teda",
    ]) {
      expect(readFileSync(join(dir, path), "utf8").startsWith("version 0.11\n")).toBe(true);
    }
    expect(readFileSync(join(dir, "design/sch/demo.sch.teda"), "utf8").startsWith("version 0.1\n")).toBe(true);
    expect(readFileSync(join(dir, "assets/components/demo.teda"), "utf8").startsWith("version 0.1\n")).toBe(true);

    const migratedFiles = [
      "project.toml",
      "views/demo/page.view.teda",
      "design/pcb/demo.pcb.teda",
      "assets/symbols/demo.symbol.teda",
      "assets/footprints/demo.footprint.teda",
      "design/sch/demo.sch.teda",
      "assets/components/demo.teda",
    ];
    const snapshot = migratedFiles.map((path) => readFileSync(join(dir, path), "utf8"));
    const second = migrate(dir);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("Nothing to change");
    expect(migratedFiles.map((path) => readFileSync(join(dir, path), "utf8"))).toEqual(snapshot);
  });
});
