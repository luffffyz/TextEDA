// Canonical formatter for `pcb` (spec/pcb.md §6).
//
// Only tests three invariants: semantic preservation (`parse(fmt(x))` ≡ `parse(x)`), idempotence, and comments are not lost.
import { describe, expect, test } from "bun:test";
import { formatPcb } from "../src/fmt-pcb.ts";
import { parsePcb } from "../src/pcb.ts";

const messy = `version 0.4
# header comment must be kept
pcb main
board_thickness 1.6mm
stackup
  B.Cu    copper     0.035mm   signal
  core    dielectric 1.53mm FR4 4.3
  F.Cu    copper     0.035  signal
outline
  0.0 30.0
  40.0 30.0
  40.0 0.0
  0.0 0.0
place
  U1  12 12  0    top
  C1  18 12  90   bottom
connect
  C1.1  U1.4
trace
  USB_DN F.Cu 0.3mm  8.0 6.0  12.0 6.0
  USB_DP F.Cu 0.3mm  12.0 4.0  8.0 4.0
rules
  diff   USB_DP  USB_DN  90Ω  0.2mm
  width  0.25mm
  clearance 0.2mm
`;

const fmt = (text: string): string => {
  const result = formatPcb(text, { file: "pcb/main.teda" });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return result.text!;
};

/** Take the content rows of one section (trimmed, excluding the section header and blank lines). */
function section(name: string): string[] {
  const lines = fmt(messy).split("\n");
  const start = lines.indexOf(name);
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith("  ")) break;
    rows.push(line.trim().split(/\s+/).join(" "));
  }
  return rows;
}

const irOf = (text: string) => JSON.stringify(parsePcb(text, { file: "pcb/main.teda", board: "main" }).ir);

describe("fmt invariants", () => {
  test("semantic preservation: parse(fmt(x)) and parse(x) produce the same IR", () => {
    expect(irOf(fmt(messy))).toBe(irOf(messy));
  });

  test("idempotence: fmt(fmt(x)) == fmt(x)", () => {
    expect(fmt(fmt(messy))).toBe(fmt(messy));
  });

  test("comments stay above the row they follow", () => {
    expect(fmt(messy)).toContain("# header comment must be kept\npcb main");
  });

  test("no output when parsing has errors (bad files are not washed into canonical)", () => {
    const result = formatPcb(messy.replace("board_thickness 1.6mm", "board_thickness 2.0mm"), { file: "pcb/main.teda" });
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });
});

describe("normalization (spec §6.2)", () => {
  const text = fmt(messy);
  test("board outline: start rotated to the smallest vertex, direction positive", () => {
    expect(section("outline")).toEqual(["0 0", "40 0", "40 30", "0 30"]);
  });

  test("connect: pairs sorted by byte order internally, rows sorted by pair", () => {
    expect(text).toContain("connect\n  C1.1  U1.4");
  });

  test("trace: reversed as a whole when the start is greater than the end, rows sorted by (net, layer, start)", () => {
    expect(text).toContain("USB_DP  F.Cu  0.3  8  4  12  4");
  });

  test("rules: fixed type order", () => {
    expect(section("rules").map((row) => row.split(/\s+/)[0])).toEqual(["clearance", "width", "diff"]);
  });

  test("values: unit dropped, trailing zeros dropped", () => {
    expect(section("stackup")[0]).toBe("B.Cu copper 0.035 signal");
    expect(section("stackup")[2]).toBe("F.Cu copper 0.035 signal");
  });
});
