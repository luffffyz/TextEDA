// 由 packages/ir/scripts/generate.ts 从 schemas/ir/v0.1 生成，不要手改。
export type IrVersion = "0.1";
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;
export type BodyItem = {
  [k: string]: unknown;
} & {
  kind: "line" | "rect" | "circle" | "arc" | "poly";
  /**
   * 0 = 所有单元共有。
   */
  unit?: number;
  /**
   * 线宽；0 = 不描边。
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
  /**
   * KiCad 填充类型；只有 rect/circle/poly 可填。
   */
  fill?: "none" | "outline" | "background";
};

/**
 * 自建符号库的一个符号的**视图**：引脚摆位、外形、单元分组、显示开关。引脚名/编号/电气类型归 `component`（单一所有者，ADR-0012）；本分片只描述怎么画。长度一律纳米整数、角度毫度整数（ADR-0004 决策 3）；+x 向右、+y 向上（KiCad 符号约定）。
 */
export interface Symbol {
  ir_version: IrVersion;
  source?: SourceRef;
  symbol: {
    /**
     * 所属库名（project.toml 的 [libs.<name>]）；KiCad 符号 id = <library>:<name>。
     */
    library: string;
    /**
     * 符号名，库内唯一；是可复用的视图名（多个器件可共享同一符号），绑定只发生在 component.symbol。
     */
    name: string;
    description?: Note;
    tags?: string[];
    /**
     * 单元数。多单元器件（双运放等）> 1；`unit=0` 的元素在所有单元共用。
     */
    units: number;
    pin_numbers_hidden: boolean;
    pin_names_hidden: boolean;
    /**
     * 引脚名相对引脚端点的偏移；缺省由导出器给 0.508mm。
     */
    pin_name_offset_nm?: number;
    /**
     * 电源符号（KiCad `(power)`）。
     */
    power: boolean;
    in_bom: boolean;
    on_board: boolean;
    /**
     * @minItems 1
     */
    pins: [Pin, ...Pin[]];
    /**
     * 符号外形；不含文字（v0.1）。
     */
    body?: BodyItem[];
    /**
     * 属性（Reference / Value / Datasheet / Description 等）。
     */
    fields?: Field[];
  };
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
export interface Pin {
  /**
   * 引脚号；名字与电气类型在导出时从 component 按此号查。
   */
  number: string;
  at: Position;
  length_nm: number;
  /**
   * 0 = 所有单元共有。
   */
  unit: number;
  style:
    | "line"
    | "inverted"
    | "clock"
    | "inverted_clock"
    | "input_low"
    | "clock_low"
    | "output_low"
    | "edge_clock_high"
    | "non_logic";
}
/**
 * 引脚连接点；rotation 是朝向（0 向右、90 向上、180 向左、270 向下）。
 */
export interface Position {
  x_nm: number;
  y_nm: number;
  rotation_mdeg?: number;
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
export interface Field {
  /**
   * 属性名，如 Reference / Value / Datasheet。
   */
  name: string;
  value: string;
  at?: Position1;
  hide?: boolean;
  effects?: TextEffects;
}
export interface Position1 {
  x_nm: number;
  y_nm: number;
  rotation_mdeg?: number;
}
export interface TextEffects {
  width_nm?: number;
  height_nm?: number;
}
