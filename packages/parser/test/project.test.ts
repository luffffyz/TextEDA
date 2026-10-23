import { describe, expect, test } from "bun:test";
import { parseProjectToml } from "../src/project.ts";

const FILE = "project.toml";

function parse(source: string) {
  return parseProjectToml(source, { file: FILE });
}

const MINIMAL = `
[project]
name = "demo"
version = "0.1.0"
format = "0.9"
`;

describe("project.toml", () => {
  test("the three required keys make a project", () => {
    const result = parse(MINIMAL);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ir?.project.name).toBe("demo");
    expect(result.ir?.project.version).toBe("0.1.0");
    expect(result.ir?.project.format).toBe("0.9");
  });

  test("a missing required key is an error", () => {
    const result = parse(`
[project]
name = "demo"
version = "0.1.0"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("`format`"))).toBe(true);
  });

  test("a missing `[project]` table is an error", () => {
    const result = parse(`
[boards.demo]
revision = "A"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "syntax.header-invalid")).toBe(true);
  });

  test("an unknown top-level table is an error", () => {
    const result = parse(`${MINIMAL}
[wibble]
x = 1
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes("unknown top-level table"))).toBe(true);
  });

  test("an unknown key in a known table is an error", () => {
    const result = parse(`${MINIMAL}
nickname = "demo"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "syntax.unknown-field")).toBe(true);
  });

  test("`[ext]` is the one free-form area", () => {
    const result = parse(`${MINIMAL}
[ext]
anything = "goes"
nested = { a = 1 }
`);
    // An inline table is outside the accepted TOML subset.
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "format.toml-invalid")).toBe(true);
  });

  test("the boards, the variants and the libraries are read", () => {
    const result = parse(`${MINIMAL}
[boards.charger-buck]
revision = "A"
title = "Charger + 5V buck"

[boards.mcu-board]
revision = "B"

[variants.default]
description = "fully populated"

[variants.lite]
dnp = ["comp_c7"]
nofit = ["comp_u3"]

[libs.project]
source = "project"
symbols = "assets/symbols/project"
footprints = "assets/footprints/project"
content_hash = "5ebab4e0a574d87541d0866664c3cf544dd736ad10cd9d6e3cdbe772ccb970a0"
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    // The boards are sorted, so the order does not depend on the file's order.
    expect(result.ir?.boards?.map((board) => board.id)).toEqual(["charger-buck", "mcu-board"]);
    expect(result.ir?.boards?.[0]?.revision).toBe("A");
    expect(result.ir?.variants?.map((variant) => variant.id)).toEqual(["default", "lite"]);
    expect(result.ir?.variants?.[1]?.dnp).toEqual(["comp_c7"]);
    expect(result.ir?.libs?.[0]?.source).toBe("project");
  });

  test("a library that is not pinned is an error", () => {
    const result = parse(`${MINIMAL}
[libs.project]
source = "project"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.project-lib-invalid")).toBe(true);
  });

  test("the default variant must exist", () => {
    const result = parse(`${MINIMAL}
default_variant = "lite"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "ref.unknown-variant")).toBe(true);
  });

  test("the operating temperature is a range of temperatures", () => {
    const result = parse(`${MINIMAL}
[compliance]
standards = ["CE", "RoHS"]
operating_temp = "0C..40C"
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.compliance?.operating_temp).toEqual({ min_mdegc: 0, max_mdegc: 40_000 });
  });

  test("a malformed temperature range is an error", () => {
    const result = parse(`${MINIMAL}
[compliance]
operating_temp = "40C"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "value.project-operating-temp-invalid")).toBe(true);
  });

  test("the authors are a list of tables", () => {
    const result = parse(`${MINIMAL}
[[project.authors]]
name = "TextEDA"

[[project.authors]]
name = "Someone"
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.project.authors).toEqual([{ name: "TextEDA" }, { name: "Someone" }]);
  });

  test("a key defined twice is an error", () => {
    const result = parse(`${MINIMAL}
name = "other"
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "format.toml-invalid")).toBe(true);
  });

  test("the same project file always parses to the same IR", () => {
    const first = parse(`${MINIMAL}
[boards.b]
[boards.a]
`);
    const second = parse(`${MINIMAL}
[boards.a]
[boards.b]
`);
    expect(first.ir).toEqual(second.ir);
  });
});
