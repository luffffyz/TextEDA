// Which board rules a pour reads (spec/pcb.md §4.9).
//
// Four of the ten rule types change the shape of a pour: `clearance` (the gap to other copper),
// `thermal` (the gap and spoke width of a thermal relief), `min_width` (copper thinner than this is
// removed) and `net` (a per-net clearance override). The rest are geometry of the drawing itself —
// `width` for traces, `via` for holes, `mask`/`paste` for the mask layers, `diff`/`match` for
// routing intent — and a pour that read them would be inventing a rule nobody declared for it.
import type { Pcb } from "@texteda/ir/pcb";
import { FILL_RULE_DEFAULTS, type FillRules } from "./types.ts";

/**
 * Read the pour-relevant rules off a board.
 *
 * A repeated rule of the same type would be ambiguous (which one applies?), so the parser's order
 * decides and later rows win — the same "later overrides earlier" reading every table in this
 * language has. `net` rows accumulate per net; they are not a default for the whole board.
 */
export function rulesFromPcb(pcb: Pcb): FillRules {
  let clearance_nm = FILL_RULE_DEFAULTS.clearance_nm;
  let thermal_gap_nm = FILL_RULE_DEFAULTS.thermal_gap_nm;
  let thermal_bridge_nm = FILL_RULE_DEFAULTS.thermal_bridge_nm;
  let min_width_nm = FILL_RULE_DEFAULTS.min_width_nm;
  const net_clearance_nm = new Map<string, number>();

  for (const rule of pcb.rules ?? []) {
    switch (rule.type) {
      case "clearance":
        clearance_nm = rule.value_nm;
        break;
      case "thermal":
        thermal_gap_nm = rule.gap_nm;
        thermal_bridge_nm = rule.bridge_nm;
        break;
      case "min_width":
        min_width_nm = rule.value_nm;
        break;
      case "net":
        net_clearance_nm.set(rule.net, rule.clearance_nm);
        break;
      default:
        break;
    }
  }

  return { clearance_nm, net_clearance_nm, thermal_gap_nm, thermal_bridge_nm, min_width_nm };
}

/** The clearance one net asks for, in nanometres: its own rule, else the board default. */
export function clearanceForNet(rules: FillRules, net: string | null): number {
  if (net === null) return rules.clearance_nm;
  return rules.net_clearance_nm.get(net) ?? rules.clearance_nm;
}

/**
 * The gap between two nets' copper: the larger of what either side asks for.
 *
 * A net rule replaces the board default for that net, and a gap has to satisfy both sides, so the
 * pair takes the maximum. Taking the minimum (or only the pour's own value) would silently narrow
 * a declaration the board made about somebody else's copper.
 */
export function pairClearance(rules: FillRules, a: string | null, b: string | null): number {
  return Math.max(clearanceForNet(rules, a), clearanceForNet(rules, b));
}
