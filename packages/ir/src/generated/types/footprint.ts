// 由 packages/ir/scripts/generate.ts 从 schemas/ir/v0.1 生成，不要手改。
export type IrVersion = "0.1";
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;
export type Pad = {
  [k: string]: unknown;
} & {
  /**
   * 焊盘号，必须与符号引脚号一致（ADR-0010 决策 3）。
   */
  number: string;
  /**
   * SMD 贴片或通孔。
   */
  type: "smd" | "th";
  shape: "rect" | "roundrect" | "oval" | "circle";
  at: Position;
  size: Size;
  drill?: Size1;
  /**
   * 焊盘所在层，如 ["F.Cu","F.Mask","F.Paste"]；通孔用 ["*.Cu","*.Mask"]。
   *
   * @minItems 1
   */
  layers: [LayerName, ...LayerName[]];
  /**
   * roundrect 圆角比例，百万分比（0=方，500000=胶囊）。IR 不允许浮点（ADR-0004 决策 3）。
   */
  roundrect_ratio_ppm?: number;
  solder_mask_margin_nm?: number;
  solder_paste_margin_nm?: number;
  clearance_nm?: number;
  zone_connect?: "solid" | "thermal" | "none";
  thermal_width_nm?: number;
  thermal_gap_nm?: number;
} & {
  /**
   * 焊盘号，必须与符号引脚号一致（ADR-0010 决策 3）。
   */
  number: string;
  /**
   * SMD 贴片或通孔。
   */
  type: "smd" | "th";
  shape: "rect" | "roundrect" | "oval" | "circle";
  at: Position;
  size: Size;
  drill?: Size1;
  /**
   * 焊盘所在层，如 ["F.Cu","F.Mask","F.Paste"]；通孔用 ["*.Cu","*.Mask"]。
   *
   * @minItems 1
   */
  layers: [LayerName, ...LayerName[]];
  /**
   * roundrect 圆角比例，百万分比（0=方，500000=胶囊）。IR 不允许浮点（ADR-0004 决策 3）。
   */
  roundrect_ratio_ppm?: number;
  solder_mask_margin_nm?: number;
  solder_paste_margin_nm?: number;
  clearance_nm?: number;
  zone_connect?: "solid" | "thermal" | "none";
  thermal_width_nm?: number;
  thermal_gap_nm?: number;
};
export type LayerName = string;
export type Graphic = {
  [k: string]: unknown;
} & {
  kind: "line" | "rect" | "circle" | "arc" | "poly";
  layer: LayerName;
  /**
   * 线宽；0 用层默认。rect/circle/poly 可省。poly 是闭合轮廓。
   */
  width_nm?: number;
  start?: Point;
  end?: Point;
  mid?: Point1;
  center?: Point;
  radius_nm?: number;
  /**
   * @minItems 3
   */
  points?: [Point, Point, Point, ...Point[]];
  filled?: boolean;
  locked?: boolean;
};

/**
 * 自建封装库的一个封装：规范描述。这是**真源**；KiCad .kicad_mod 是导出产物（ADR-0011）。长度一律纳米整数、角度毫度整数（ADR-0008）；原点是封装中心，+x 向右、+y 向下（KiCad 约定）。
 */
export interface Footprint {
  ir_version: IrVersion;
  source?: SourceRef;
  footprint: {
    /**
     * 所属库名（project.toml 的 [libs.<name>]）；KiCad 封装 id = <library>:<name>。
     */
    library: string;
    /**
     * 封装名，如 ti-sot-23-5。库内唯一。
     */
    name: string;
    description?: Note;
    tags?: string[];
    /**
     * KiCad (attr …) 标志；缺省按 pads 推断（全是 smd → smd）。
     */
    attr?: ("smd" | "through_hole" | "virtual" | "board_only")[];
    /**
     * @minItems 1
     */
    pads: [Pad, ...Pad[]];
    /**
     * 丝印/装配/阻焊/ courtyard 等图形。
     */
    graphics?: Graphic[];
    texts?: TextItem[];
    /**
     * 封装属性（Reference / Value / Datasheet 等）。
     */
    fields?: Field[];
    model3d?: Model3D;
  };
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
export interface Position {
  x_nm: number;
  y_nm: number;
  rotation_mdeg?: number;
}
export interface Size {
  x_nm: number;
  y_nm: number;
}
/**
 * 通孔钻孔尺寸（th 必填）。
 */
export interface Size1 {
  x_nm: number;
  y_nm: number;
}
export interface Point {
  x_nm: number;
  y_nm: number;
}
/**
 * arc 的中点。
 */
export interface Point1 {
  x_nm: number;
  y_nm: number;
}
export interface TextItem {
  text: string;
  at: Position;
  layer: LayerName;
  hide?: boolean;
  effects?: TextEffects;
}
export interface TextEffects {
  width_nm?: number;
  height_nm?: number;
  thickness_nm?: number;
  bold?: boolean;
  italic?: boolean;
}
export interface Field {
  /**
   * 属性名，如 Reference / Value / Datasheet。
   */
  name: string;
  value: string;
  at?: Position;
  layer?: LayerName;
  hide?: boolean;
  effects?: TextEffects;
}
export interface Model3D {
  /**
   * 3D 模型文件路径，项目相对（.stp / .stpZ / .wrl）。
   */
  path: string;
  /**
   * 偏移 x/y/z，纳米。
   *
   * @minItems 3
   * @maxItems 3
   */
  offset_nm?: [number, number, number];
  /**
   * 缩放 x/y/z，百万分比（1000000 = 1 倍）。IR 不允许浮点。
   *
   * @minItems 3
   * @maxItems 3
   */
  scale_ppm?: [number, number, number];
  /**
   * 旋转 x/y/z，毫度。
   *
   * @minItems 3
   * @maxItems 3
   */
  rotation_mdeg?: [number, number, number];
}
