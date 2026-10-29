// The catalogue: the verbs a host can register as tools, and the rule that keeps the two faces
// honest.
//
// A tool's result must equal the same verb's `--json` output, field for field (ADR-0143 D2). The
// test runs both and compares them — not a spot check, every tool in the catalogue.
import { describe, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findTool, TOOLS, toolCatalogue } from "../src/tools.ts";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const project = join(import.meta.dir, "../../../examples/reference-project");

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** A copy of the reference project: the tools that write must not touch the repository. */
function copyProject(): string {
  const dir = join(tmpdir(), `texteda-tools-${process.pid}-${Math.random().toString(36).slice(2)}`);
  cpSync(project, dir, { recursive: true });
  return dir;
}

/** The verb, its arguments, and the tool that mirrors it. */
const CASES: { tool: string; args: string[]; call: Record<string, unknown> }[] = [
  {
    tool: "texteda_check",
    args: ["check", "PROJECT", "--json"],
    call: { project_dir: "PROJECT" },
  },
  {
    tool: "texteda_view_metrics",
    args: ["view", "metrics", "PROJECT", "charger-buck/buck-5v", "--json"],
    call: { project_dir: "PROJECT", board: "charger-buck", page: "buck-5v" },
  },
  {
    tool: "texteda_view_render",
    args: ["view", "render", "PROJECT", "charger-buck/buck-5v", "--json"],
    call: { project_dir: "PROJECT", board: "charger-buck", page: "buck-5v" },
  },
  {
    tool: "texteda_view_rewire",
    args: ["view", "rewire", "PROJECT", "charger-buck/buck-5v", "--json"],
    call: { project_dir: "PROJECT", board: "charger-buck", page: "buck-5v" },
  },
  {
    tool: "texteda_ir",
    args: ["ir", "PROJECT", "--json"],
    call: { project_dir: "PROJECT" },
  },
  {
    tool: "texteda_netlist",
    args: ["netlist", "PROJECT", "--board", "charger-buck", "--json"],
    call: { project_dir: "PROJECT", board: "charger-buck" },
  },
  {
    tool: "texteda_bom",
    args: ["bom", "PROJECT", "charger-buck", "--json"],
    call: { project_dir: "PROJECT", board: "charger-buck" },
  },
  {
    tool: "texteda_export_gerbers",
    args: ["export", "gerbers", "PROJECT", "charger-buck", "--json"],
    call: { project_dir: "PROJECT", board: "charger-buck" },
  },
];

describe("the tool catalogue", () => {
  test("every tool's result equals the same verb's --json output", () => {
    for (const testCase of CASES) {
      const dir = copyProject();
      const tool = findTool(testCase.tool);
      expect(tool).toBeDefined();

      const command = run(testCase.args.map((arg) => (arg === "PROJECT" ? dir : arg)));
      expect(command.code).toBe(0);

      const call = { ...testCase.call };
      for (const [key, value] of Object.entries(call)) {
        if (value === "PROJECT") call[key] = dir;
      }
      const result = tool!.run(call);
      expect(result.ok).toBe(true);

      expect(result.value).toEqual(JSON.parse(command.stdout));
    }
  });

  test("the catalogue is machine-readable and complete", () => {
    const catalogue = toolCatalogue();
    expect(catalogue).toHaveLength(TOOLS.length);
    const names = catalogue.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of catalogue) {
      expect(tool.name).toMatch(/^texteda_[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.parameters.type).toBe("object");
      for (const property of Object.values(tool.parameters.properties ?? {})) {
        expect(property.type).toBeDefined();
        expect(property.description?.length ?? 0).toBeGreaterThan(0);
      }
      for (const required of tool.parameters.required ?? []) {
        expect(Object.keys(tool.parameters.properties ?? {})).toContain(required);
      }
    }
  });

  test("`texteda tools --json` prints the catalogue", () => {
    const result = run(["tools", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(toolCatalogue());
  });

  test("a tool that is missing an argument says so", () => {
    const result = findTool("texteda_view_metrics")!.run({ project_dir: project });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("required");
  });
});
