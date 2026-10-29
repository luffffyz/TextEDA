// The TextEDA tools in a DeepSeek Harness session.
//
// A DSH plugin is a cordis plugin: it declares the services it needs and registers what it
// offers. This one registers the catalogue — the same eight verbs the command line has
// (ADR-0143 D7) — as tools, with the catalogue's JSON Schema projected onto DSH's flat
// parameter spec.
//
// The plugin is thin on purpose: it translates the arguments and hands the value back, and
// nothing here decides what a tool does. The verb does (ADR-0143 D2, ADR-0144 D5).
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import { dshTools } from "../../packages/cli/src/dsh-tools.ts";

export const name = "texteda";

/** The services this plugin needs from the host. */
export const inject = ["tools"];

export function apply(ctx: Context): void {
  for (const tool of dshTools()) {
    ctx.tools.register(defineTool(tool));
  }
}
