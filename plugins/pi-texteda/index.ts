// The TextEDA tools in a pi session.
//
// A pi extension is a module whose default export is a factory: the host hands over its API and
// the factory registers what it wants (see `omp://extensions.md`). This one registers the
// catalogue — the same eight verbs the command line has (ADR-0143 D7) — projected onto pi's
// schema dialect.
//
// The extension is thin on purpose: it translates the arguments and hands the value back, and
// nothing here decides what a tool does. The verb does (ADR-0143 D2, ADR-0144 D5).
import { piTools, type PiTool, type ZodLike } from "../../packages/cli/src/pi-tools.ts";

/** The part of pi's API this extension uses. */
interface ExtensionApi {
  /** The host's Zod-compatible builder. */
  readonly zod: ZodLike;
  /** Register a tool the model may call. */
  registerTool(tool: PiTool): void;
}

export default function textedaTools(pi: ExtensionApi): void {
  for (const tool of piTools(pi.zod)) {
    pi.registerTool(tool);
  }
}
