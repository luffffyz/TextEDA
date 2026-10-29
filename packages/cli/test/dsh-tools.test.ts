// The catalogue, projected onto DSH's tool registry.
//
// DSH's parameter spec is flat: one line per parameter, with `required` and `description` beside
// the type. The test reads that view back, because it is the view the host validates against.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { dshTools } from "../src/dsh-tools.ts";
import { toolCatalogue } from "../src/tools.ts";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const project = join(import.meta.dir, "../../../examples/reference-project");

describe("the DSH projection", () => {
  test("the tools are the catalogue's entries", () => {
    const tools = dshTools();
    expect(tools.map((tool) => tool.name)).toEqual(toolCatalogue().map((tool) => tool.name));
    expect(tools.map((tool) => tool.description)).toEqual(toolCatalogue().map((tool) => tool.description));
  });

  test("the parameters are the catalogue's, in DSH's flat spec", () => {
    const catalogue = toolCatalogue();
    const tools = dshTools();
    for (const [index, tool] of tools.entries()) {
      const expected = catalogue[index]?.parameters;
      const required = new Set(expected?.required ?? []);
      expect(Object.keys(tool.parameters).sort()).toEqual(Object.keys(expected?.properties ?? {}).sort());
      for (const [name, property] of Object.entries(expected?.properties ?? {})) {
        const parameter = tool.parameters[name];
        expect(parameter?.type).toBe(property.type);
        expect(parameter?.required === true).toBe(required.has(name));
        expect(parameter?.description).toBe(property.description);
      }
    }
  });

  test("a tool's value is the value the command line prints", async () => {
    const proc = Bun.spawn(["bun", "run", script, "view", "metrics", project, "charger-buck/buck-5v", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const tool = dshTools().find((entry) => entry.name === "texteda_view_metrics");
    expect(tool).toBeDefined();
    const value = await tool?.execute({
      project_dir: project,
      board: "charger-buck",
      page: "buck-5v",
    });
    expect(value).toEqual(JSON.parse(stdout));
  });

  test("the value is what the model reads", async () => {
    const tool = dshTools().find((entry) => entry.name === "texteda_view_metrics");
    const value = await tool?.execute({
      project_dir: project,
      board: "charger-buck",
      page: "buck-5v",
    });
    const content = tool?.output.render({}, value);
    expect(content?.[0]?.type).toBe("text");
    expect(JSON.parse(content?.[0]?.text ?? "{}")).toEqual(value);
  });

  test("a verb that cannot do its work throws", async () => {
    const tool = dshTools().find((entry) => entry.name === "texteda_view_metrics");
    await expect(tool?.execute({})).rejects.toThrow("required");
  });
});
