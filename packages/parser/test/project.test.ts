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
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    // The boards are sorted, so the order does not depend on the file's order.
    expect(result.ir?.boards?.map((board) => board.id)).toEqual(["charger-buck", "mcu-board"]);
    expect(result.ir?.boards?.[0]?.revision).toBe("A");
    expect(result.ir?.variants?.map((variant) => variant.id)).toEqual(["default", "lite"]);
    expect(result.ir?.variants?.[1]?.dnp).toEqual(["comp_c7"]);
  });

  test("`[libs]` is withdrawn, and the message says what to do instead", () => {
    const result = parse(`${MINIMAL}
[libs.project]
source = "project"
content_hash = "00"
`);
    expect(result.ok).toBe(false);
    const found = result.diagnostics.find((d) => d.code === "syntax.unknown-field");
    expect(found?.message).toContain("`[libs]` was withdrawn");
    expect(found?.message).toContain("lib import");
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

describe("owner (ADR-0136 D5)", () => {
  test("is returned beside the IR, not inside it", () => {
    const result = parse(`${MINIMAL}owner = "carol"\n`);
    expect(result.diagnostics).toEqual([]);
    expect(result.owner).toBe("carol");
    // Ownership is a fact about the project: it must not reach the shard, or changing it would change a hash.
    expect(result.ir?.project).not.toHaveProperty("owner");
  });

  test("a project without an owner simply has none", () => {
    expect(parse(MINIMAL).owner).toBeUndefined();
  });

  test("a non-string owner is an error", () => {
    const result = parse(`${MINIMAL}owner = 42\n`);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["value.project-owner-invalid"]);
  });
});
