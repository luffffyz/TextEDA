// The copper-fill policy layer (ADR-0117 D3): what a pour must keep clear of, and what copper it
// leaves behind. The kernel (`@texteda/geom`) knows shapes; this layer knows nets, layers, clearance
// and thermal settings, and it is where DRC and the routing tools will get their geometry from.
//
// Nothing here touches the IR or a hash: a pour is recomputed from `zone` + `rules` at export time
// (spec/pcb.md §4.7), so it may always be thrown away and rebuilt.
export {
  ARC_SEGMENTS,
  buildObstacles,
  copperLayers,
  cutoutRings,
  outlineRing,
  padLayers,
  padOutline,
  toBoard,
  toBoardPoint,
  viaLayers,
} from "./obstacles.ts";
export { fillBoard, fillZone, cutRadius, type FillResult, type ZoneFill } from "./fill.ts";
export { clearanceForNet, pairClearance, rulesFromPcb } from "./rules.ts";
export { thermalRelief, type ThermalGeometry } from "./thermal.ts";
export {
  FILL_RULE_DEFAULTS,
  type FillFacts,
  type FillKeepout,
  type FillObstacle,
  type FillOutput,
  type FillRules,
  type FillZoneInput,
  type ObstacleFacts,
  type PinNet,
  type PlacedFootprint,
  type ZoneConnect,
} from "./types.ts";
export { fillBoardFacts } from "./board.ts";
