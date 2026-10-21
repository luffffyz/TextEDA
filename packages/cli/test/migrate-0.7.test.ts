// The 0.6 -> 0.7 migration (ADR-0025): the board becomes one flat file, the page files disappear,
// the print pages and the pcb description lose their page prefixes -- and a name collision stops
// the migration instead of picking a name.
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(repoRoot, "scripts", "migrate-0.7.ts");
const fixture = join(repoRoot, "tests", "migration", "project-0.6");

function runMigration(projectDir: string): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, projectDir], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-migrate-"));
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

describe("migration 0.6 -> 0.7", () => {
  test("merges the pages into one flat board file", () => {
    const dir = copyFixture();
    const run = runMigration(dir);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);

    // The page files are gone; the board root is the only schematic file.
    expect(existsSync(join(dir, "sch", "demo", "power.teda"))).toBe(false);
    expect(existsSync(join(dir, "sch", "demo", "sense.teda"))).toBe(false);

    const board = readFileSync(join(dir, "sch", "demo.teda"), "utf8");
    expect(board.startsWith("version 0.7\nschematic demo\n")).toBe(true);
    // Both pages' instances are in the board, with no page prefix.
    for (const refdes of ["C1", "C2", "R1", "R2", "U1", "U2"]) {
      expect(board).toContain(`  ${refdes}  `);
    }
    expect(board).not.toContain("P1.");
    expect(board).not.toContain("P2.");
    // The nets that the board exported through page ports are merged into one board net.
    expect(board).toMatch(/GND:.*C1\.2.*C2\.2/);
    expect(board).toMatch(/SYS:.*C1\.1.*C2\.1/);
    // The page ports are gone; the board's own ports stay.
    expect(board).toContain("GND   GND");
    expect(board).not.toContain("SYS_OUT");
    // The page constraints travel with the board.
    expect(board).toContain("voltage  SENSE  0V..3.3V");
  });

  test("the print page keeps the board's net names", () => {
    const dir = copyFixture();
    expect(runMigration(dir).code).toBe(0);
    const view = readFileSync(join(dir, "sch", "demo", "power.view.teda"), "utf8");
    expect(view.startsWith("version 0.7\nview power\n")).toBe(true);
    expect(view).toContain("GND  C1.2  U1.GND");
    // The view still names the board's instances.
    expect(view).toContain("U1  100.0");
  });

  test("the pcb description loses the page prefixes", () => {
    const dir = copyFixture();
    expect(runMigration(dir).code).toBe(0);
    const pcb = readFileSync(join(dir, "pcb", "demo.teda"), "utf8");
    expect(pcb.startsWith("version 0.7\npcb demo\n")).toBe(true);
    expect(pcb).not.toContain("P1.");
    expect(pcb).toContain("  C1  10  10  0  top");
    expect(pcb).toContain("  C1.1  U1.1");
  });

  test("a name collision stops the migration and leaves the project alone", () => {
    const dir = copyFixture();
    // The sense page now uses C1 as well.
    const sense = join(dir, "sch", "demo", "sense.teda");
    writeFileSync(sense, readFileSync(sense, "utf8").replace("  C2  c-0402  100n", "  C1  c-0402  100n"));
    const before = readFileSync(join(dir, "sch", "demo.teda"), "utf8");

    const run = runMigration(dir);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("C1");
    // Nothing was written: the board still has its pages.
    expect(readFileSync(join(dir, "sch", "demo.teda"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "sch", "demo", "power.teda"))).toBe(true);
  });
});
