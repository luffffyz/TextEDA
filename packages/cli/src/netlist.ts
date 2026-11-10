// `texteda netlist`: the project's connectivity, projected from the IR.
//
// The netlist is a projection of the **validated** design: a design with errors does not get one,
// because a netlist made from a broken design would only mislead whoever reads it downstream.
//
// The project has one logical root (ADR-0069 D1), so it has exactly one netlist: the whole
// product's connectivity, with no per-PCB duplicate. The value is built here and printed by the
// script, so the command line and a host's tool registry call the same function (ADR-0044 D2).
import type { Netlist } from "@texteda/exporter/netlist";
import { formatNetlist, toNetlist } from "@texteda/exporter/netlist";
import { analyzeProject } from "./check.ts";
import type { VerbResult } from "./result.ts";

export interface NetlistOptions {
  /** Project root directory. */
  readonly root: string;
}

export interface NetlistValue {
  /** The machine payload: the project's one netlist. */
  readonly payload: Netlist;
  /** The human text: the netlist as it is written on paper. */
  readonly text: string;
}

/**
 * The project's netlist.
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

  const ir = result.main.ir;
  if (ir === undefined) {
    return {
      ok: false,
      code: "cli.bad-usage",
      error: "No project schematic: the logical root design/sch/main.teda is missing",
    };
  }

  const netlist = toNetlist(ir);
  return {
    ok: true,
    value: {
      payload: netlist,
      text: formatNetlist(netlist),
    },
  };
}
