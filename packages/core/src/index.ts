export {
  checkConnectivity,
  type ConnectivityFacts,
  type ConnectivityNet,
  type ConnectivityPin,
} from "./erc/connectivity.ts";

export { checkBinding, instanceOf, type BindingFacts } from "./binding/checks.ts";
export {
  checkCopperCoverage,
  type CopperFacts,
  type CopperGraph,
  type InstancePads,
  type PadGeometry,
} from "./binding/copper.ts";

export { checkDeviceUsage, type DeviceUsageFacts } from "./devices/usage.ts";
export { packagePowerRating, chipResistorPackages } from "./devices/packages.ts";

export { checkViews, type ViewFacts, type ViewPage } from "./view/checks.ts";
export { viewMetrics, type NetTextMetric, type ViewMetrics } from "./view/metrics.ts";
export {
  nearestOnPath,
  ON_NET_NM,
  reanchorWire,
  reseatOnNet,
  type Reanchored,
  type ReanchorInput,
  type WireCorners,
} from "./view/reroute.ts";
export {
  checkReadability,
  type ReadabilityBox,
  type ReadabilityFacts,
  type ReadabilityField,
  type ReadabilityGeometry,
  type ReadabilitySymbol,
  type ReadabilityText,
} from "./view/readability.ts";

export { checkRatings, type RatingDevice, type RatingFacts } from "./design/ratings.ts";

export {
  checkDeviceDeclaration,
  checkDeviceParamValue,
  checkDeviceRatingValue,
  checkDeviceRatings,
  DEVICE_CONSTRUCTIONS,
  DEVICE_CONSTRUCTION_NAMES,
  DEVICE_PARAM_VALUE_SETS,
  DEVICE_PRIMARY_ROLE,
  DEVICE_ROLE_TYPES,
  type DeviceConstruction,
  type DeviceDeclarationFacts,
  type DeviceParamFact,
  type DeviceRatingFact,
  type DeviceRatingFacts,
  type DeviceRole,
} from "./devices/rules.ts";

export {
  buildBomLines,
  checkProcurement,
  type BomLine,
  type DesignLine,
  type Device,
  type FactLocation,
  type ProcurementFacts,
  type Selection,
} from "./procurement/rules.ts";

export { checkSystem, type SystemFacts } from "./system/rules.ts";

export {
  checkReviews,
  REVIEW_VERDICTS,
  type ReviewDecision,
  type ReviewFacts,
  type ReviewNote,
  type ReviewRound,
} from "./review/checks.ts";

export {
  buildObstacles,
  cutoutRings,
  fillBoard,
  fillZone,
  fillBoardFacts,
  outlineRing,
  rulesFromPcb,
  FILL_RULE_DEFAULTS,
  type FillFacts,
  type FillObstacle,
  type FillOutput,
  type FillResult,
  type FillRules,
  type FillZoneInput,
  type PlacedFootprint,
} from "./fill/index.ts";

export { boardImage, EDGE_WIDTH_NM, type BoardImageFacts } from "./board-image.ts";

export {
  boardSides,
  isSilkLayer,
  mirrorLayer,
  padMaskLayers,
  padPasteLayers,
  padSideLayers,
  type BoardSide,
  type BoardSideLayers,
  type SideLayerFamily,
} from "./layers.ts";

export {
  maskExpansionOf,
  maskOpeningDiameter,
  maskRule,
  openingOf,
  pasteApertureOf,
  pasteGeometryOf,
  pasteOpeningDiameter,
  pasteRule,
  MASK_RULE_DEFAULTS,
  PASTE_RULE_DEFAULTS,
  type MaskRule,
  type PasteRule,
} from "./mask-paste.ts";

export {
  silkItemsOf,
  silkRules,
  silkTexts,
  uprightTurn,
  SILK_RULE_DEFAULTS,
  SILK_WIDTH_NM,
  type SilkItemRule,
  type SilkRules,
  type SilkText,
} from "./silk.ts";
export type { BoardImage, DrawItem, DrillHit, FlashItem, ImageItem, ImageLayer, ManufacturingFile, ManufacturingStamp, RegionItem } from "./image.ts";
