import { describe, expect, test } from "bun:test";
import { parseSystem } from "../src/system.ts";

const FILE = "design/system/cabinet.teda";

function parse(source: string) {
  return parseSystem(source, { file: FILE });
}

const SYSTEM = `
version 0.2
system cabinet

boards
  amp
  ctrl

nets
  GND: amp.GND ctrl.GND
  SYS: amp.SYS_IN ctrl.SYS_OUT
`;

describe("the system description", () => {
  test("a system reads its boards and its nets", () => {
    const result = parse(SYSTEM);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.ir?.system).toBe("cabinet");
    expect(result.ir?.boards.map((board) => board.id)).toEqual(["amp", "ctrl"]);
    expect(result.ir?.nets).toEqual([
      { id: "GND", members: ["amp.GND", "ctrl.GND"] },
      { id: "SYS", members: ["amp.SYS_IN", "ctrl.SYS_OUT"] },
    ]);
  });

  test("the header must be `version` then `system <id>`", () => {
    const result = parse(`
version 0.2
boards
  amp
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "syntax.header-invalid")).toBe(true);
  });

  test("an unknown section is an error", () => {
    const result = parse(`
version 0.2
system cabinet

wibble
  amp
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "syntax.unknown-section")).toBe(true);
  });

  test("a net needs at least two members", () => {
    const result = parse(`
version 0.2
system cabinet

boards
  amp
  ctrl

nets
  GND: amp.GND
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "syntax.net-invalid")).toBe(true);
  });

  test("a member is a port reference: a board id and a port id", () => {
    const result = parse(`
version 0.2
system cabinet

boards
  amp
  ctrl

nets
  GND: amp.GND ctrl
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "syntax.port-ref-invalid")).toBe(true);
  });

  test("a long net continues on the next line", () => {
    const result = parse(`
version 0.2
system cabinet

boards
  amp
  ctrl
  io

nets
  GND: amp.GND ctrl.GND
  : io.GND
`);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir?.nets).toEqual([
      { id: "GND", members: ["amp.GND", "ctrl.GND", "io.GND"] },
    ]);
  });

  test("the same board twice is an error", () => {
    const result = parse(`
version 0.2
system cabinet

boards
  amp
  amp
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "ref.duplicate-board")).toBe(true);
  });

  test("the same system net twice is an error", () => {
    const result = parse(`
version 0.2
system cabinet

boards
  amp
  ctrl

nets
  GND: amp.GND ctrl.GND
  GND: amp.SYS ctrl.SYS
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "ref.duplicate-net")).toBe(true);
  });

  test("a system needs at least one board", () => {
    const result = parse(`
version 0.2
system cabinet

nets
  GND: amp.GND ctrl.GND
`);
    expect(result.ok).toBe(false);
  });
});
