export {
  checkConnectivity,
  type ConnectivityFacts,
  type ConnectivityNet,
  type ConnectivityPin,
} from "./erc/connectivity.ts";

export { checkBinding, instanceOf, type BindingFacts } from "./binding/checks.ts";

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
