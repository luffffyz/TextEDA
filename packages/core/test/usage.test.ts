// The library curation rule: a device file nothing uses is allowed but reported (ADR-0006).
import { describe, expect, test } from "bun:test";
import { checkDeviceUsage } from "../src/devices/usage.ts";

describe("checkDeviceUsage", () => {
  test("a device nothing places and nothing selects is a warning", () => {
    const diagnostics = checkDeviceUsage({
      devices: [
        { id: "r-0402", file: "assets/components/passives/r-0402.teda" },
        { id: "tps7a02", file: "assets/components/regulators/tps7a02.teda" },
      ],
      referenced: new Set(["r-0402"]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe("library.device-unused");
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(diagnostics[0]!.message).toContain("tps7a02");
    // Line 2 is the `component <id>` header: the message is about that name.
    expect(diagnostics[0]!.location).toEqual({
      file: "assets/components/regulators/tps7a02.teda",
      line: 2,
      col: 1,
    });
  });

  test("a device named only by a procurement selection counts as used", () => {
    // A second source exists so a board can be built with it: it is not dead weight.
    const diagnostics = checkDeviceUsage({
      devices: [{ id: "crc0402fr-0710kl", file: "assets/components/passives/crc0402fr-0710kl.teda" }],
      referenced: new Set(["crc0402fr-0710kl"]),
    });
    expect(diagnostics).toEqual([]);
  });

  test("an empty library produces nothing", () => {
    expect(checkDeviceUsage({ devices: [], referenced: new Set() })).toEqual([]);
  });
});
