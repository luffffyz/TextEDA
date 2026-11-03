// What a host behind this document permits the viewer to write (ADR-0043 D3, D6).
//
// The viewer has one interaction surface. These helpers describe the host boundary only; drawing
// kind decides which actions are meaningful, and no interaction mode is represented here.
import type { ReviewCapability } from "./types.ts";

/** Whether the host permits the full page-view write, including fields and source text. */
export function capabilityAllowsFull(capability: ReviewCapability | undefined): boolean {
  return capability === undefined || capability.write === "layout";
}

/** Whether the host permits placement writes. A full layout host includes the placement subset. */
export function capabilityAllowsPlaces(capability: ReviewCapability | undefined): boolean {
  return capability === undefined || capability.write === "places" || capability.write === "layout";
}
