// Host capability boundaries are independent of the viewer's single interaction surface.
import { describe, expect, test } from "bun:test";
import { capabilityAllowsFull, capabilityAllowsPlaces } from "../src/capability.ts";

describe("review write capabilities", () => {
  test("standalone review has the full write boundary", () => {
    expect(capabilityAllowsFull(undefined)).toBe(true);
    expect(capabilityAllowsPlaces(undefined)).toBe(true);
  });

  test("DSH places-only hosts permit placement but not fields or source", () => {
    const capability = { write: "places" as const };
    expect(capabilityAllowsPlaces(capability)).toBe(true);
    expect(capabilityAllowsFull(capability)).toBe(false);
  });

  test("full page-view hosts include the placement subset", () => {
    const capability = { write: "layout" as const };
    expect(capabilityAllowsPlaces(capability)).toBe(true);
    expect(capabilityAllowsFull(capability)).toBe(true);
  });
});
