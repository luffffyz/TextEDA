// The catalogue, projected onto pi's tool registry.
//
// pi takes a tool as a schema plus a function; the catalogue's schema is JSON Schema, and pi
// wants the Zod-compatible builder the host injects (`pi.zod`). This file is the projection and
// nothing else: it translates the schema and hands the value back. It does not decide what a
// tool does — the verb does (ADR-0143 D2, ADR-0144 D5).
import { toolAnswer } from "./result.ts";
import { TOOLS, type JsonSchema } from "./tools.ts";

/** The part of pi's Zod-compatible builder this projection uses. */
export interface ZodLike {
  object(shape: Record<string, unknown>): ZodField;
  string(): ZodField;
  number(): ZodField;
  boolean(): ZodField;
  array(item: unknown): ZodField;
  enum(values: readonly string[]): ZodField;
}

/** A schema node. The only operation the projection needs is `optional`. */
export interface ZodField {
  optional(): ZodField;
}

/** One tool as pi's registry wants it. */
export interface PiTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: ZodField;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
  ): Promise<{
    content: { type: "text"; text: string }[];
    details?: unknown;
    isError?: boolean;
  }>;
}

/**
 * Attach a description, if the builder knows how.
 *
 * The builder is the host's, not ours: `describe` is a Zod operation, and the host's builder is
 * Zod-compatible rather than Zod. So the call is made only when the method is there.
 */
function described(field: ZodField, text: string | undefined): ZodField {
  if (text === undefined) return field;
  const candidate = field as ZodField & { describe?: (description: string) => ZodField };
  return typeof candidate.describe === "function" ? candidate.describe(text) : field;
}

/** One schema node, as the host's builder wants it. */
function toZod(z: ZodLike, schema: JsonSchema): ZodField {
  switch (schema.type) {
    case "string": {
      const base = schema.enum === undefined ? z.string() : z.enum(schema.enum);
      return described(base, schema.description);
    }
    case "number":
      return described(z.number(), schema.description);
    case "boolean":
      return described(z.boolean(), schema.description);
    case "array": {
      const item = schema.items === undefined ? z.string() : toZod(z, schema.items);
      return described(z.array(item), schema.description);
    }
    case "object": {
      const shape: Record<string, unknown> = {};
      const required = new Set(schema.required ?? []);
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        const field = toZod(z, property);
        shape[name] = required.has(name) ? field : field.optional();
      }
      return described(z.object(shape), schema.description);
    }
  }
}

/** The label a host shows: the tool's name, in words. */
function label(name: string): string {
  const words = name.split("_");
  const head = words[0] ?? name;
  const tail = words.slice(1).join(" ");
  return tail.length === 0 ? head : `${head} ${tail}`;
}

/**
 * The catalogue as pi's tools.
 *
 * Every tool is the same verb the command line calls, and every result is the value that verb
 * prints with `--json` (ADR-0143 D2). A verb that could not do its work is a tool error the
 * model can read and answer with different arguments.
 */
export function piTools(z: ZodLike): PiTool[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    label: label(tool.name),
    description: tool.description,
    parameters: toZod(z, tool.parameters),
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const answer = toolAnswer(tool.run(params));
      return {
        content: [{ type: "text", text: answer.text }],
        details: answer.value ?? null,
        isError: answer.isError,
      };
    },
  }));
}
