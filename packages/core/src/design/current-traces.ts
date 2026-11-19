// The PCB-side check for a stated rail current (ADR-0081).
// It compares declared trace widths only; it does not model current capacity or branch distribution.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Pcb } from "@texteda/ir/pcb";
import { amps } from "./current.ts";

export interface CurrentTraceFacts {
  readonly file: string;
  readonly pcb: Pcb;
  /** Where an IR record was written (ADR-0004 D1: the IR carries no line numbers). */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
}

function mm(nm: number): string {
  const value = (nm / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${value}mm`;
}

/** Compare each matching trace's declared width with the current rule's minimum width. */
export function checkCurrentTraceWidths(facts: CurrentTraceFacts): Diagnostic[] {
  const { file, pcb } = facts;
  const fileOnly: DiagnosticLocation = { file, line: 1, col: 1 };
  const at = (path: string): DiagnosticLocation => facts.locate?.(path) ?? fileOnly;
  const diagnostics: Diagnostic[] = [];

  for (const [ruleIndex, rule] of pcb.rules.entries()) {
    if (rule.type !== "current") continue;
    const traces = (pcb.trace ?? []).flatMap((trace, index) =>
      trace.net === rule.net ? [{ trace, index }] : [],
    );
    const vias = (pcb.via ?? []).flatMap((via, index) =>
      via.net === rule.net ? [{ via, index, stitching: false }] : [],
    );
    for (const [index, item] of (pcb.physical_only ?? []).entries()) {
      if (item.type === "stitching" && item.net === rule.net) {
        vias.push({ via: item, index, stitching: true });
      }
    }
    const zones = (pcb.zone ?? []).flatMap((zone, index) =>
      zone.net === rule.net ? [{ zone, index }] : [],
    );

    for (const { trace, index } of traces) {
      if (trace.width_nm >= rule.min_width_nm) continue;
      diagnostics.push({
        code: "drc.current-trace-width",
        severity: "error",
        message: `trace ${index + 1} on net ${rule.net} declares ${mm(trace.width_nm)}, below the current rule minimum ${mm(rule.min_width_nm)} for ${amps(rule.max_na)} maximum current`,
        hint: `declare a trace width of at least ${mm(rule.min_width_nm)}, or revise the stated PCB current rule`,
        location: at(`/trace/${index}`),
        data: {
          pcb: pcb.pcb,
          net: rule.net,
          max_na: rule.max_na,
          min_width_nm: rule.min_width_nm,
          width_nm: trace.width_nm,
          trace_index: index,
        },
      });
    }

    const stitchingVias = vias.filter(({ stitching }) => stitching).length;
    const viaSummary = vias.length === 0
      ? "no same-net vias"
      : `${vias.length} same-net via(s)${stitchingVias > 0 ? `, including ${stitchingVias} stitching via(s)` : ""} at ${vias.slice(0, 4).map(({ via }) => `[${mm(via.x_nm)},${mm(via.y_nm)}]`).join(", ")}${vias.length > 4 ? ", …" : ""}`;
    const zoneSummary = zones.length === 0
      ? "no same-net zones/pours"
      : `${zones.length} same-net zone(s)/pour(s) on ${zones.slice(0, 4).map(({ zone }) => zone.layer).join(", ")}${zones.length > 4 ? ", …" : ""}`;
    diagnostics.push({
      code: "drc.current-trace-only",
      severity: "note",
      message: `PCB ${pcb.pcb} current rule for ${rule.net} states ${amps(rule.max_na)} maximum current and ${mm(rule.min_width_nm)} minimum width; checked ${traces.length} matching trace declaration(s) only. This does not verify geometric current capacity or branch-current distribution; via and zone/pour capacity is not checked (${viaSummary}; ${zoneSummary}).`,
      hint: "review via and pour capacity and the rail's current distribution separately; a passing trace-width check is not a current-capacity verdict",
      location: at(`/rules/${ruleIndex}`),
      data: {
        pcb: pcb.pcb,
        net: rule.net,
        max_na: rule.max_na,
        min_width_nm: rule.min_width_nm,
        traces_checked: traces.length,
        vias_unchecked: vias.length,
        stitching_vias_unchecked: stitchingVias,
        zones_unchecked: zones.length,
        source: rule.source,
      },
    });
  }
  return diagnostics;
}
