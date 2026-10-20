// 类型层断言：生成的 TS 类型必须与契约对得上。
// 少一个必填字段、写错一个字面量，这里就编译不过（@ts-expect-error 会在类型放宽时报错）。
import { expect, test } from "bun:test";
import { validate } from "../src/index.ts";
import type { Schematic } from "../src/generated/types/schematic.ts";
import type { Component } from "../src/generated/types/component.ts";
import type { Pcb } from "../src/generated/types/pcb.ts";

const minimalSchematic: Schematic = {
  ir_version: "0.1",
  format: "0.3",
  board: "demo",
  instances: [],
  nets: [],
};

// @ts-expect-error ir_version 目前只有 0.1；类型一旦放宽，这条断言会编译失败
const wrongVersion: Schematic = { ...minimalSchematic, ir_version: "0.2" };

const minimalComponent: Component = {
  ir_version: "0.1",
  component: {
    id: "r-0402",
    package: "0402",
    symbol: "kicad:Device:R",
    footprint: "kicad:Resistor_SMD:R_0402_1005Metric",
    pins: [{ number: "1", name: "A", electrical_type: "passive" }],
    pins_source: "inline",
  },
};

const wrongPinsSource: Component = {
  ...minimalComponent,
  // @ts-expect-error pins_source 是枚举，不是自由字符串
  component: { ...minimalComponent.component, pins_source: "nope" },
};

const minimalPcb: Pcb = {
  ir_version: "0.1",
  format: "0.4",
  board: "demo",
  board_thickness_nm: 1600000,
  stackup: [
    { layer: "F.Cu", type: "copper", thickness_nm: 35000, kind: "signal" },
    { layer: "B.Cu", type: "copper", thickness_nm: 35000, kind: "signal" },
  ],
  outline: [
    { x_nm: 0, y_nm: 0 },
    { x_nm: 20000000, y_nm: 0 },
    { x_nm: 0, y_nm: 15000000 },
  ],
  place: [],
  connect: [],
  rules: [{ type: "clearance", value_nm: 200000 }],
};

test("生成的类型与契约一致", () => {
  expect(validate("schematic", minimalSchematic).ok).toBe(true);
  expect(validate("component", minimalComponent).ok).toBe(true);
  expect(validate("pcb", minimalPcb).ok).toBe(true);
  expect(String(wrongVersion.ir_version)).toBe("0.2");
  expect(String(wrongPinsSource.component.pins_source)).toBe("nope");
});
