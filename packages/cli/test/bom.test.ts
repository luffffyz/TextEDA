// The `texteda bom` command: the board's bill of materials (`spec/procurement.md` §5).
//
// The command is exercised on the reference project: the table has to be right for a real board,
// because a BOM that is wrong is worse than no BOM at all.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const project = join(import.meta.dir, "../../../examples/reference-project");

/** Run the CLI once, capturing the exit code and output. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("texteda bom", () => {
  test("prints a table with one row per BOM line", () => {
    const result = run(["bom", project, "charger-buck"]);
    expect(result.code).toBe(0);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe("component_id,mpn,params,quantity,status,refdes,note");
    expect(lines.length).toBeGreaterThan(10);
  });

  test("a part the design names carries its part number", () => {
    const result = run(["bom", project, "charger-buck"]);
    const row = result.stdout.split("\n").find((line) => line.startsWith("bq24610rger,"));
    expect(row).toBeDefined();
    expect(row).toContain("BQ24610RGER");
    expect(row).toContain("bought");
  });

  test("a generic line with a selection carries the selected part's number", () => {
    const result = run(["bom", project, "charger-buck"]);
    const row = result.stdout
      .split("\n")
      .find((line) => line.startsWith("res-thick-0402,RC0402FR-0710KL,"));
    expect(row).toBeDefined();
    // The line is 10kΩ ±1% and the board uses it twice.
    expect(row).toContain("10k");
    expect(row).toContain(",2,bought,");
  });

  test("a generic line nobody sourced carries no part number", () => {
    const result = run(["bom", project, "charger-buck"]);
    const row = result.stdout
      .split("\n")
      .find((line) => line.startsWith("cap-mlcc-0402,,100nF 10% 16V dielectric=X7R,"));
    expect(row).toBeDefined();
    expect(row).toContain("unsourced");
  });

  test("--json prints the machine payload", () => {
    const result = run(["bom", project, "charger-buck", "--json"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.board).toBe("charger-buck");
    const bought = payload.lines.find((line: { component_id: string }) => line.component_id === "bq24610rger");
    expect(bought.mpn).toBe("BQ24610RGER");
    expect(bought.status).toBe("bought");
    expect(bought.quantity).toBe(1);
  });

  test("--out writes the table to a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "texteda-bom-"));
    try {
      const out = join(dir, "nested", "bom.csv");
      const result = run(["bom", project, "charger-buck", "--out", out]);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown board is an error", () => {
    const result = run(["bom", project, "no-such-board"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Board root file not found");
  });
});
