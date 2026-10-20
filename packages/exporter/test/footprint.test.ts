// 封装导出器的单元测试：不依赖 KiCad，只验生成的 S-expression 文本。
// 端到端（KiCad 能读、DRC 干净、能出 Gerber）由 scripts/smoke-footprint.ts 负责。
import { describe, expect, test } from "bun:test";
import { deriveUuid, deg, footprintInline, footprintModule, mm, type FootprintBody } from "../src/footprint.ts";

const thruHolePad: FootprintBody["pads"][number] = {
  number: "2",
  type: "th",
  shape: "circle",
  at: { x_nm: 1000000, y_nm: 0 },
  size: { x_nm: 1600000, y_nm: 1600000 },
  drill: { x_nm: 1000000, y_nm: 1000000 },
  layers: ["*.Cu", "*.Mask"],
};

const fp: FootprintBody = {
  library: "project",
  name: "demo-part",
  description: "示例",
  tags: ["tag-a", "tag-b"],
  pads: [
    {
      number: "1",
      type: "smd",
      shape: "roundrect",
      at: { x_nm: -950000, y_nm: 950000 },
      size: { x_nm: 1100000, y_nm: 600000 },
      layers: ["F.Cu", "F.Mask", "F.Paste"],
      roundrect_ratio_ppm: 250000,
    },
    thruHolePad,
  ],
  graphics: [
    {
      kind: "rect",
      layer: "F.CrtYd",
      start: { x_nm: -1650000, y_nm: -1200000 },
      end: { x_nm: 1650000, y_nm: 1200000 },
      width_nm: 50000,
    },
  ],
  fields: [
    { name: "Reference", value: "REF**", at: { x_nm: 0, y_nm: -2000000 }, layer: "F.SilkS" },
    { name: "Value", value: "demo", at: { x_nm: 0, y_nm: 2000000 }, layer: "F.Fab" },
  ],
};

describe("单位换算", () => {
  test("纳米转毫米并去掉尾随零", () => {
    expect(mm(510000)).toBe("0.51");
    expect(mm(0)).toBe("0");
    expect(mm(1)).toBe("0.000001");
    expect(mm(-500000)).toBe("-0.5");
  });

  test("毫度转度", () => {
    expect(deg(90000)).toBe("90");
    expect(deg(0)).toBe("0");
  });
});

describe("库文件", () => {
  const out = footprintModule(fp);

  test("tags 必须是一个引号字符串（多个字符串会让 KiCad 拒绝加载库）", () => {
    expect(out).toContain('(tags "tag-a tag-b")');
    expect(out).not.toContain('"tag-a" "tag-b"');
  });

  test("焊盘、图层、几何、属性都在", () => {
    expect(out).toContain(
      '(pad "1" smd roundrect (at -0.95 0.95) (size 1.1 0.6) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))',
    );
    expect(out).toContain(
      '(pad "2" thru_hole circle (at 1 0) (size 1.6 1.6) (drill 1) (layers "*.Cu" "*.Mask"))',
    );
    expect(out).toContain(
      '(fp_rect (start -1.65 -1.2) (end 1.65 1.2) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))',
    );
    expect(out).toContain('(property "Reference" "REF**" (at 0 -2) (layer "F.SilkS")');
    expect(out).toContain("(attr smd)");
  });

  test("通孔钻孔为椭圆时写 oval", () => {
    const oval = footprintModule({
      ...fp,
      pads: [fp.pads[0], { ...thruHolePad, drill: { x_nm: 700000, y_nm: 2500000 } }],
    });
    expect(oval).toContain("(drill oval 0.7 2.5)");
  });
});

describe("板内联块", () => {
  const out = footprintInline(fp, {
    xNm: 25_000_000,
    yNm: 20_000_000,
    reference: "U1",
    value: "SOT-23-5",
  });

  test("位置、库前缀、位号与值都进去", () => {
    expect(out).toContain('(footprint "project:demo-part"');
    expect(out).toContain("(at 25 20)");
    expect(out).toContain('(property "Reference" "U1"');
    expect(out).toContain('(property "Value" "SOT-23-5"');
  });

  test("uuid 由内容派生，同输入同输出", () => {
    const again = footprintInline(fp, {
      xNm: 25_000_000,
      yNm: 20_000_000,
      reference: "U1",
      value: "SOT-23-5",
    });
    expect(again).toBe(out);
    expect(deriveUuid("x")).toBe(deriveUuid("x"));
    expect(deriveUuid("x")).not.toBe(deriveUuid("y"));
    expect(deriveUuid("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
