// The catalogue: the verbs that can be exposed as tools in a host's registry.
//
// A tool is a model-callable function with a name, a description and typed arguments. The command
// line already has all three, so the catalogue is not a second interface — it is the verbs,
// described in the one format every host can be projected onto (ADR-0044 D7, D8).
//
// The parameters are JSON Schema, because that is what four of the six surveyed hosts take
// unchanged — and what Claude Code's own registry takes unchanged too — what DSH's flat spec is a
// flattening of, and what pi normalises to anyway (`docs/tool-formats.md`).
//
// The rule that keeps the two faces honest: a tool's result equals the same verb's `--json`
// output, field for field. Both call the same function (ADR-0044 D2).
import { join, resolve } from "node:path";
import { buildBom } from "./bom.ts";
import { buildCheck } from "./check.ts";
import { buildExport } from "./export.ts";
import { buildIr } from "./ir.ts";
import { buildNetlist } from "./netlist.ts";
import { buildViewMetrics, buildViewRender, buildViewRewire } from "./view.ts";
import { failed, type VerbResult } from "./result.ts";

/** The JSON Schema subset the catalogue uses. */
export interface JsonSchema {
  readonly type: "object" | "string" | "number" | "boolean" | "array";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly string[];
  readonly default?: unknown;
}

/** What a host can know about a tool before it runs it. */
export interface ToolAnnotations {
  /** The tool only reads; it changes nothing. */
  readonly readOnlyHint?: boolean;
  /** The tool writes over something a person made. */
  readonly destructiveHint?: boolean;
  /** Running it twice changes nothing the second time. */
  readonly idempotentHint?: boolean;
}

/** One entry of the catalogue. */
export interface Tool {
  /** The name the model calls: the command's words, in the tool spelling. */
  readonly name: string;
  /** One sentence: what the tool does, and where the manual is. */
  readonly description: string;
  /** The arguments, as JSON Schema. */
  readonly parameters: JsonSchema;
  /** What the host can know before the tool runs. */
  readonly annotations?: ToolAnnotations;
  /** The verb itself: the same function the command line calls. */
  run(args: Readonly<Record<string, unknown>>): VerbResult<unknown>;
}

/** A string argument, or nothing when the caller left it out or sent something else. */
function text(args: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A boolean argument; absent means false. */
function flag(args: Readonly<Record<string, unknown>>, name: string): boolean {
  return args[name] === true;
}

/** The `project_dir` argument every tool takes. */
function projectDir(args: Readonly<Record<string, unknown>>): string | undefined {
  return text(args, "project_dir");
}

/** The catalogue, in the order the skills teach them. */
export const TOOLS: readonly Tool[] = [
  {
    name: "texteda_check",
    description:
      "Validate a TextEDA project: parse, contract, ERC, binding, device and drawing checks. Returns every diagnostic with its code, severity and location.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
      },
      required: ["project_dir"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      if (dir === undefined) return failed("project_dir is required");
      const built = buildCheck(dir);
      if (built.value === undefined) return built;
      // The findings are the answer, errors or not; `ok` says whether the project is clean.
      return { ok: built.ok, value: built.value.payload };
    },
  },
  {
    name: "texteda_view_metrics",
    description:
      "Measure one print page: sheet use, counts, label and text gaps, wire length, crossings, wires through bodies, and how far each label is from its net.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        board: { type: "string", description: "The board id." },
        page: { type: "string", description: "The print page id." },
      },
      required: ["project_dir", "board", "page"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      const board = text(args, "board");
      const page = text(args, "page");
      if (dir === undefined || board === undefined || page === undefined) {
        return failed("project_dir, board and page are required");
      }
      return buildViewMetrics({ root: dir, board, page, json: false });
    },
  },
  {
    name: "texteda_view_render",
    description:
      "Draw one print page as an SVG file, with the same renderer the review app uses. Writes dist/view/<board>/<page>.svg unless out says otherwise.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        board: { type: "string", description: "The board id." },
        page: { type: "string", description: "The print page id." },
        out: { type: "string", description: "Where to write the SVG; defaults to dist/view/<board>/<page>.svg." },
      },
      required: ["project_dir", "board", "page"],
    },
    annotations: { idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      const board = text(args, "board");
      const page = text(args, "page");
      if (dir === undefined || board === undefined || page === undefined) {
        return failed("project_dir, board and page are required");
      }
      const out = text(args, "out");
      return buildViewRender({
        root: dir,
        board,
        page,
        json: false,
        ...(out === undefined ? {} : { outFile: out }),
      });
    },
  },
  {
    name: "texteda_view_rewire",
    description:
      "Bring a print page's wiring back onto its pins after a part moved: the interior corners keep their coordinates, the ends are put back where the pins are. Reports the wires it could not fix.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        board: { type: "string", description: "The board id." },
        page: { type: "string", description: "The print page id." },
        dry_run: { type: "boolean", description: "Report what would change without writing the page." },
      },
      required: ["project_dir", "board", "page"],
    },
    annotations: { idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      const board = text(args, "board");
      const page = text(args, "page");
      if (dir === undefined || board === undefined || page === undefined) {
        return failed("project_dir, board and page are required");
      }
      return buildViewRewire({ root: dir, board, page, dryRun: flag(args, "dry_run"), json: false });
    },
  },
  {
    name: "texteda_ir",
    description:
      "Build the project's IR shard tree: canonical JSON per description, a manifest with one SHA-256 per shard, the project hash and the per-board hashes.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        out: { type: "string", description: "Where to write the tree; defaults to dist/ir." },
      },
      required: ["project_dir"],
    },
    annotations: { idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      if (dir === undefined) return failed("project_dir is required");
      const out = text(args, "out");
      return buildIr({ root: dir, ...(out === undefined ? {} : { outDir: out }) });
    },
  },
  {
    name: "texteda_netlist",
    description:
      "The board's connectivity as a netlist: the nets, their members and the pins they join. Refuses to build one from a design that has errors.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        board: { type: "string", description: "Only this board; every board when absent." },
      },
      required: ["project_dir"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      if (dir === undefined) return failed("project_dir is required");
      const board = text(args, "board");
      const built = buildNetlist({ root: dir, ...(board === undefined ? {} : { board }) });
      if (!built.ok || built.value === undefined) return built;
      return { ok: true, value: built.value.payload };
    },
  },
  {
    name: "texteda_bom",
    description:
      "The board's bill of materials: one row per line, with the part that is bought, how many of them the board uses, and the line's procurement status.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        board: { type: "string", description: "The board id." },
      },
      required: ["project_dir", "board"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      const board = text(args, "board");
      if (dir === undefined || board === undefined) return failed("project_dir and board are required");
      const built = buildBom({ root: dir, board });
      if (!built.ok || built.value === undefined) return built;
      return { ok: true, value: built.value.payload };
    },
  },
  {
    name: "texteda_export_gerbers",
    description:
      "Write the board's manufacturing files: one Gerber per layer, the Excellon drill file, and the stamp that ties them to the project's hash.",
    parameters: {
      type: "object",
      properties: {
        project_dir: { type: "string", description: "The project directory." },
        board: { type: "string", description: "The board id." },
        out: { type: "string", description: "Where to write the files; defaults to dist/fab/<board>." },
      },
      required: ["project_dir", "board"],
    },
    annotations: { idempotentHint: true },
    run(args) {
      const dir = projectDir(args);
      const board = text(args, "board");
      if (dir === undefined || board === undefined) return failed("project_dir and board are required");
      const out = text(args, "out");
      const outDir = resolve(out ?? join(dir, "dist", "fab", board));
      return buildExport(
        {
          root: dir,
          board,
          json: false,
          ...(out === undefined ? {} : { outDir }),
        },
        outDir,
      );
    },
  },
];

/** The catalogue as it is printed: the facts a host needs, without the functions. */
export function toolCatalogue(): { name: string; description: string; parameters: JsonSchema; annotations?: ToolAnnotations }[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
  }));
}

/** The tool with this name, or nothing. */
export function findTool(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
