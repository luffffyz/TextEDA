// Unit tests for the `footprint` canonical form (spec/footprint.md §8).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canonicalJson,
  descriptionType,
  formatFootprint,
  formatSymbol,
  parseFootprint,
  parseSymbol,
} from "../src/index.ts";

const example = readFileSync("examples/reference-project/assets/footprints/project/sot-23-5.teda", "utf8");

function format(text: string): string {
  const result = formatFootprint(text, { file: "x.teda", library: "project" });
  if (!result.ok || result.text === undefined) {
    throw new Error(`formatting failed: ${JSON.stringify(result.diagnostics)}`);
  }
  return result.text;
}

describe("canonical form", () => {
  test("the example file itself is already canonical", () => {
    expect(format(example)).toBe(example);
  });

  test("idempotent", () => {
    const once = format(example);
    expect(format(once)).toBe(once);
  });

  test("rows/keys/comments/units normalize in one pass", () => {
    const messy = [
      "# file header comment",
      "version 0.4",
      "footprint   messy",
      "",
      "field Value   R_0402",
      "# this belongs to description",
      "description   a  b",
      "tags   b  a",
      "attr smd",
      "",
      "pads",
      "  10  smd  roundrect  1mm  0  1mm  0.5mm   rot=90  rratio=0.250",
      "  2   smd  rect  0.95mm  -0.95mm  1.1mm  0.6mm",
      "",
    ].join("\n");

    expect(format(messy)).toBe(
      [
        "# file header comment",
        "version 0.4",
        "footprint messy",
        "",
        "# this belongs to description",
        "description a b",
        "tags a b",
        "attr smd",
        "field Value R_0402",
        "",
        "pads",
        "  2   smd  rect       0.95  -0.95  1.1  0.6",
        "  10  smd  roundrect  1     0      1    0.5  rot=90  rratio=0.25",
        "",
      ].join("\n"),
    );
  });

  test("non-default units convert to mm, then the unit suffix is omitted", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "pads",
      "  1  smd  rect  10mil  0  40mil  20mil",
      "",
    ].join("\n");
    expect(format(text)).toContain("  1  smd  rect  0.254  0  1.016  0.508");
  });

  test("graphics sort by (kind, layer, geometry); th pads keep drill", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "pads",
      "  1  th  circle  0  0  1.6  1.6  drill=1.0mm",
      "",
      "graphics",
      "  rect  F.Fab  0,0,1,1  width=0.1",
      "  line  F.SilkS  0,0,1,1  width=0.12",
      "",
    ].join("\n");
    const out = format(text);
    expect(out).toContain("  1  th  circle  0  0  1.6  1.6  drill=1");
    expect(out.indexOf("line  F.SilkS")).toBeLessThan(out.indexOf("rect  F.Fab"));
  });

  test("semantics unchanged: the IR depends only on semantics (independent of source order and unit spelling)", () => {
    const messy = [
      "version 0.4",
      "footprint t",
      "",
      "tags b a",
      "field Value R",
      "field Reference R",
      "pads",
      "  10  smd  rect  1mm  1mm  1mm  1mm",
      "  2   smd  rect  0.95mm  0  1.1mm  0.6mm",
      "",
      "graphics",
      "  rect  F.Fab  0,0,1,1  width=0.1",
      "  line  F.SilkS  0,0,1,1  width=0.12",
      "",
    ].join("\n");
    const before = parseFootprint(messy, { file: "x.teda", library: "project" });
    const after = parseFootprint(format(messy), { file: "x.teda", library: "project" });
    expect(canonicalJson(after.ir)).toBe(canonicalJson(before.ir));
  });

  test("a comment moves together with the row it belongs to", () => {
    const text = ["version 0.4", "footprint t", "", "pads", "# belongs to pad 2", "  2  smd  rect  0  0  1  1", "  1  smd  rect  0  0  1  1", ""].join("\n");
    expect(format(text)).toBe(
      ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0  0  1  1", "# belongs to pad 2", "  2  smd  rect  0  0  1  1", ""].join("\n"),
    );
  });

  test("duplicate section headers merge into one", () => {
    const text = ["version 0.4", "footprint t", "", "pads", "  1  smd  rect  0  0  1  1", "", "pads", "  2  smd  rect  0  0  1  1", ""].join("\n");
    const out = format(text);
    expect(out.split("\npads\n").length - 1).toBe(1);
    expect(out).toContain("  2  smd  rect  0  0  1  1");
  });

  test("section order is fixed to pads → graphics; an empty graphics section and its comment are both kept", () => {
    const text = [
      "version 0.4",
      "footprint t",
      "",
      "graphics",
      "# this footprint has no graphics yet",
      "",
      "pads",
      "  1  smd  rect  0  0  1  1",
      "",
    ].join("\n");
    // The rule is "a comment follows the next effective line": when a section has no rows, it follows the next section header.
    expect(format(text)).toBe(
      [
        "version 0.4",
        "footprint t",
        "",
        "# this footprint has no graphics yet",
        "pads",
        "  1  smd  rect  0  0  1  1",
        "",
        "graphics",
        "",
      ].join("\n"),
    );
  });

  test("type line detection (the CLI dispatches on it; other description types are skipped first)", () => {
    expect(descriptionType("# comment\nversion 0.4\nfootprint t\n")).toBe("footprint");
    expect(descriptionType("version 0.4\npcb charger-buck\n")).toBe("pcb");
    expect(descriptionType("")).toBeNull();
  });

  test("input with errors produces no text (fix errors before formatting)", () => {
    const result = formatFootprint("version 0.4\nfootprint t\n\npads\n  1  th  circle  0  0  1.6  1.6\n", {
      file: "x.teda",
      library: "project",
    });
    expect(result.ok).toBe(false);
    expect(result.text).toBeUndefined();
  });
});

describe("the file revision has a canonical place", () => {
  test("symbol: `rev` is emitted first among the scalars, wherever it was written", () => {
    const text = [
      "version 0.5.1",
      "symbol t",
      "",
      "description a part",
      "rev 2.1.0",
      "",
      "pins",
      "  1  0  0  0",
      "",
    ].join("\n");
    const result = formatSymbol(text, { file: "x.teda", library: "project" });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.text).toContain(["symbol t", "", "rev 2.1.0", "description a part"].join("\n"));
    expect(formatSymbol(result.text!, { file: "x.teda", library: "project" }).text).toBe(result.text);
  });

  test("footprint: `rev` is emitted first among the scalars", () => {
    const text = [
      "version 0.4.2",
      "footprint f",
      "",
      "package_code 0402",
      "rev 2.1.0",
      "",
      "pads",
      "  1  smd  roundrect  0  0  1.1  0.6  rratio=0.25",
      "",
    ].join("\n");
    const result = formatFootprint(text, { file: "x.teda", library: "project" });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.text).toContain(["footprint f", "", "rev 2.1.0", "package_code 0402"].join("\n"));
    expect(formatFootprint(result.text!, { file: "x.teda", library: "project" }).text).toBe(result.text);
  });
});

describe("canonical form of symbol", () => {
  const symbolExample = readFileSync("examples/reference-project/assets/symbols/project/bq24610rger.teda", "utf8");

  function formatSymbolText(text: string): string {
    const result = formatSymbol(text, { file: "x.teda", library: "project" });
    if (!result.ok || result.text === undefined) {
      throw new Error(`formatting failed: ${JSON.stringify(result.diagnostics)}`);
    }
    return result.text;
  }

  test("the example file itself is already canonical", () => {
    expect(formatSymbolText(symbolExample)).toBe(symbolExample);
  });

  test("idempotent", () => {
    const once = formatSymbolText(symbolExample);
    expect(formatSymbolText(once)).toBe(once);
  });

  test("defaults are not written: length/unit/style and scalars like units/power", () => {
    const text = [
      "version 0.5",
      "symbol t",
      "",
      "units 1",
      "power no",
      "in_bom yes",
      "pin_numbers show",
      "pins",
      "  1  0  0  0  length=2.54  unit=1  style=line",
      "  2  0  0  0  length=3  style=clock",
      "",
    ].join("\n");
    const out = formatSymbolText(text);
    expect(out).toContain("  1  0  0  0");
    expect(out).toContain("  2  0  0  0  length=3  style=clock");
    expect(out).not.toContain("units 1");
    expect(out).not.toContain("power no");
    expect(out).not.toContain("in_bom yes");
    expect(out).not.toContain("pin_numbers show");
  });

  test("pins sort by (unit, number); semantics unchanged", () => {
    const text = [
      "version 0.5",
      "symbol t",
      "",
      "units 2",
      "pins",
      "  2  0  0  0  unit=2",
      "  10  0  0  0",
      "  1  0  0  0",
      "",
    ].join("\n");
    const out = formatSymbolText(text);
    const order = out.split("\n").filter((l) => /^\s+\d/.test(l));
    expect(order[0]).toContain(" 1  ");
    expect(order[1]).toContain(" 10  ");
    expect(order[2]).toContain(" 2  ");
    const before = parseSymbol(text, { file: "x.teda", library: "project" });
    const after = parseSymbol(out, { file: "x.teda", library: "project" });
    expect(canonicalJson(after.ir)).toBe(canonicalJson(before.ir));
  });
});
