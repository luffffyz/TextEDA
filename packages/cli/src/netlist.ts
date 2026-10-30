// `texteda netlist`: the board's connectivity, projected from the IR.
//
// The netlist is a projection of the **validated** design: a design with errors does not get one,
// because a netlist made from a broken design would only mislead whoever reads it downstream.
//
// The value is built here and printed by the script, so the command line and a host's tool
// registry call the same function (ADR-0044 D2).
import type { Netlist } from "@texteda/exporter/netlist";
import { formatNetlist, toNetlist } from "@texteda/exporter/netlist";
import { analyzeProject } from "./check.ts";
import type { VerbResult } from "./result.ts";

export interface NetlistOptions {
  /** Project root directory. */
  readonly root: string;
  /** Only this board; every board when absent. */
  readonly board?: string | undefined;
}

export interface NetlistValue {
  /** The machine payload: one netlist, or the list of them when the project has several boards. */
  readonly payload: Netlist | Netlist[];
  /** The human text: the netlists as they are written on paper. */
  readonly text: string;
}

/**
 * The project's netlists.
 *
 * Fails when the design has errors: the diagnostics go with the failure, so the caller can print
 * the same lines the command line prints.
 */
export function buildNetlist(options: NetlistOptions): VerbResult<NetlistValue> {
  const result = analyzeProject(options.root);

  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    const lines = errors.map((diagnostic) => {
      const where = diagnostic.location
        ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
        : "";
      return `${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
    });
    lines.push(`Netlist not exported: ${errors.length} errors (run texteda check first to see how to fix them)`);
    return { ok: false, error: lines.join("\n") };
  }

  const chosen = result.analyses.filter(
    (analysis) => analysis.ir !== undefined && (options.board === undefined || analysis.board === options.board),
  );
  if (chosen.length === 0) {
    const available = result.boards.join(", ") || "none";
    return {
      ok: false,
      code: "cli.bad-usage",
      error:
        options.board === undefined
          ? "No exportable boards in the project"
          : `Board ${options.board} not found (available: ${available})`,
    };
  }

  const netlists = chosen.map((analysis) => toNetlist(analysis.ir!));
  return {
    ok: true,
    value: {
      payload: netlists.length === 1 ? netlists[0]! : netlists,
      text: netlists.map((netlist) => formatNetlist(netlist)).join("\n"),
    },
  };
}
