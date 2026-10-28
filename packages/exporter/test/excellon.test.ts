// The drill file is a byte contract too (ADR-0117 D9): one file, tools
// ascending from T1, coordinates exact and sorted, and M30 last.
import { describe, expect, test } from "bun:test";
import type { BoardImage, DrillHit, ManufacturingStamp } from "@texteda/core/image";
import { drillDecimal, toExcellon } from "../src/excellon.ts";

const stamp: ManufacturingStamp = { tool_version: "1.2.3", source_hash: "abc123" };

function image(drills: DrillHit[], board = "demo"): BoardImage {
  return { board, layers: [], drills };
}

const hole = (x_nm: number, y_nm: number, diameter_nm: number, plated = true): DrillHit => ({
  x_nm,
  y_nm,
  diameter_nm,
  plated,
});

describe("drillDecimal", () => {
  test("exact millimetres with trailing zeros dropped and one digit kept", () => {
    expect(drillDecimal(13_800_000)).toBe("13.8");
    expect(drillDecimal(29_160_000)).toBe("29.16");
    expect(drillDecimal(25_200_000)).toBe("25.2");
    expect(drillDecimal(13_000_000)).toBe("13.0");
    expect(drillDecimal(0)).toBe("0.0");
    expect(drillDecimal(1)).toBe("0.000001");
    expect(drillDecimal(-2_500_000)).toBe("-2.5");
  });
});

describe("header", () => {
  test("M48, comments, FMAT, metric, tool table, %, then M30", () => {
    const [file] = toExcellon(image([hole(0, 0, 300_000), hole(1_000_000, 1_000_000, 3_200_000, false)]), stamp);
    expect(file!.name).toBe("demo.drl");
    expect(file!.text.split("\n")).toEqual([
      "M48",
      ";TextEDA 1.2.3",
      ";source abc123",
      ";unplated: 1",
      "FMAT,2",
      "METRIC,TZ",
      "T1C0.300000",
      "T2C3.200000",
      "%",
      "T1",
      "X0.0Y0.0",
      "T2",
      "X1.0Y1.0",
      "M30",
      "",
    ]);
  });

  test("no unplated holes means no comment at all", () => {
    const [file] = toExcellon(image([hole(0, 0, 300_000)]), stamp);
    expect(file!.text).not.toContain("unplated");
  });

  test("a board with no holes writes no file", () => {
    expect(toExcellon(image([]), stamp)).toEqual([]);
    // A zero diameter is not a hole either: the file would define an unusable tool.
    expect(toExcellon(image([hole(0, 0, 0)]), stamp)).toEqual([]);
  });
});

describe("tools and holes", () => {
  test("tools are numbered from T1 in ascending diameter order, whatever the hit order", () => {
    const [file] = toExcellon(image([hole(0, 0, 3_200_000), hole(0, 0, 300_000), hole(0, 0, 1_000_000)]), stamp);
    expect(file!.text).toContain("T1C0.300000\nT2C1.000000\nT3C3.200000");
  });

  test("holes are grouped by tool and sorted by x then y", () => {
    const [file] = toExcellon(
      image([hole(2_000_000, 0, 300_000), hole(1_000_000, 5_000_000, 300_000), hole(1_000_000, 1_000_000, 300_000)]),
      stamp,
    );
    expect(file!.text.split("\n").slice(7)).toEqual(["T1", "X1.0Y1.0", "X1.0Y5.0", "X2.0Y0.0", "M30", ""]);
  });

  test("the same image twice is byte-identical", () => {
    const drills = [hole(3_000_000, 4_000_000, 300_000), hole(1_000_000, 2_000_000, 3_200_000, false)];
    expect(toExcellon(image(drills), stamp)).toEqual(toExcellon(image([...drills].reverse()), stamp));
  });

  test("ends with exactly one newline", () => {
    const [file] = toExcellon(image([hole(0, 0, 300_000)]), stamp);
    expect(file!.text.endsWith("M30\n")).toBe(true);
    expect(file!.text.endsWith("M30\n\n")).toBe(false);
  });
});
