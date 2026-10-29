// The catalogue, projected onto pi's tool registry.
//
// The projection is what the model sees: which arguments a tool takes, and which of them it must
// be given. The test reads that view back from a recording builder, because the host's own
// builder is only available inside a session.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { piTools, type ZodField, type ZodLike } from "../src/pi-tools.ts";
import { toolCatalogue } from "../src/tools.ts";

const script = join(import.meta.dir, "../scripts/texteda.ts");
const project = join(import.meta.dir, "../../../examples/reference-project");

/** A recorded schema node: what the builder was asked for. */
interface FakeField extends ZodField {
  readonly kind: string;
  readonly isOptional: boolean;
  readonly shape?: Record<string, unknown>;
}

/** A builder that keeps what it was asked for, as plain data. */
function recordingZod(): ZodLike {
  const node = (kind: string, shape?: Record<string, unknown>): FakeField => {
    const field: FakeField = {
      kind,
      isOptional: false,
      ...(shape === undefined ? {} : { shape }),
      optional() {
        return { ...field, isOptional: true };
      },
    };
    return field;
  };
  return {
    object: (shape) => node("object", shape),
    string: () => node("string"),
    number: () => node("number"),
    boolean: () => node("boolean"),
    array: () => node("array"),
    enum: () => node("enum"),
  };
}

/** The recorded shape of a schema, when the node has one. */
function shapeOf(field: ZodField): Record<string, unknown> {
  if (typeof field !== "object" || field === null || !("shape" in field)) return {};
  const shape = field.shape;
  if (typeof shape !== "object" || shape === null) return {};
  const entries: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(shape)) entries[name] = value;
  return entries;
}

/** Whether a field may be left out. */
function isOptional(field: unknown): boolean {
  return typeof field === "object" && field !== null && "isOptional" in field && field.isOptional === true;
}

describe("the pi projection", () => {
  test("the tools are the catalogue's entries", () => {
    const tools = piTools(recordingZod());
    expect(tools.map((tool) => tool.name)).toEqual(toolCatalogue().map((tool) => tool.name));
    expect(tools.map((tool) => tool.description)).toEqual(toolCatalogue().map((tool) => tool.description));
  });

  test("the arguments the model sees are the catalogue's arguments", () => {
    const catalogue = toolCatalogue();
    const tools = piTools(recordingZod());
    for (const [index, tool] of tools.entries()) {
      const expected = catalogue[index]?.parameters;
      const properties = Object.keys(expected?.properties ?? {});
      const required = new Set(expected?.required ?? []);
      const shape = shapeOf(tool.parameters);
      expect(Object.keys(shape).sort()).toEqual(properties.sort());
      for (const name of properties) {
        expect({ name, optional: isOptional(shape[name]) }).toEqual({ name, optional: !required.has(name) });
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

    const tool = piTools(recordingZod()).find((entry) => entry.name === "texteda_view_metrics");
    expect(tool).toBeDefined();
    const result = await tool?.execute("call-1", {
      project_dir: project,
      board: "charger-buck",
      page: "buck-5v",
    });
    expect(JSON.parse(result?.content[0]?.text ?? "{}")).toEqual(JSON.parse(stdout));
  });

  test("a check that found errors hands the diagnostics back", async () => {
    const tool = piTools(recordingZod()).find((entry) => entry.name === "texteda_check");
    // The repository root is not a TextEDA project: the check runs and finds errors.
    const result = await tool?.execute("call-1", { project_dir: join(import.meta.dir, "../../..") });
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("diagnostics");
  });

  test("a tool that cannot do its work says so, and is an error", async () => {
    const tool = piTools(recordingZod()).find((entry) => entry.name === "texteda_view_metrics");
    const result = await tool?.execute("call-1", {});
    expect(result?.isError).toBe(true);
    expect(result?.content[0]?.text).toContain("required");
  });
});
