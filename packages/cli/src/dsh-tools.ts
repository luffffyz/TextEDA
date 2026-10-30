// The catalogue, projected onto DSH's tool registry.
//
// DSH's parameter spec is flat and bespoke: one line per parameter — `{type, required,
// description}` — rather than JSON Schema (see `docs/tool-formats.md`). The result of a tool is
// a canonical JSON value, and `output.render` turns that value into what the model reads.
//
// The projection is the whole of this file's job. The verb does the work (ADR-0044 D2).
import { toolAnswer } from "./result.ts";
import { TOOLS, type JsonSchema } from "./tools.ts";

/** DSH's flat parameter spec. */
export interface DshParameter {
  readonly type: "string" | "number" | "integer" | "boolean" | "null" | "array" | "object";
  readonly required?: boolean;
  readonly description?: string;
}

/** The tool definition DSH's registry takes. */
export interface DshTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, DshParameter>;
  readonly output: {
    readonly schema: { readonly type: "object"; readonly additionalProperties: boolean };
    readonly render: (args: unknown, value: unknown) => { readonly type: "text"; readonly text: string }[];
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/** The catalogue's JSON Schema, as DSH's flat spec: one line per parameter. */
export function flatParameters(schema: JsonSchema): Record<string, DshParameter> {
  const parameters: Record<string, DshParameter> = {};
  const required = new Set(schema.required ?? []);
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    parameters[name] = {
      type: property.type,
      ...(required.has(name) ? { required: true } : {}),
      ...(property.description === undefined ? {} : { description: property.description }),
    };
  }
  return parameters;
}

/**
 * The catalogue as DSH's tools.
 *
 * Every tool is the same verb the command line calls, and every result is the value that verb
 * prints with `--json` (ADR-0044 D2). A verb that could not do its work throws: DSH turns a
 * throw into an error the model reads.
 */
export function dshTools(): DshTool[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: flatParameters(tool.parameters),
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args: unknown, value: unknown) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: Record<string, unknown>) {
      const answer = toolAnswer(tool.run(args));
      if (answer.value === undefined) throw new Error(answer.text);
      return answer.value;
    },
  }));
}
