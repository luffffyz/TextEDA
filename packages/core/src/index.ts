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
