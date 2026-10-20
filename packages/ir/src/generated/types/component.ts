// 由 packages/ir/scripts/generate.ts 从 schemas/ir/v0.1 生成，不要手改。
export type IrVersion = "0.1";
/**
 * 产生该分片的 .teda 文件的语言版本，见 teda.md §13。
 */
export type FormatVersion = string;
/**
 * 库引用 lib:name，如 kicad:Device:R。
 */
export type LibraryRef = string;
/**
 * 参数类型决定 IR 里的整数单位：resistance→µΩ、capacitance→fF、inductance→pH、voltage→µV、current→nA、power→µW、frequency→mHz、length→nm、temperature→m°C、percent→ppm、integer→1。见 ADR-0008 决策 4。
 */
export type ParamType =
  | "resistance"
  | "capacitance"
  | "inductance"
  | "voltage"
  | "current"
  | "power"
  | "frequency"
  | "length"
  | "temperature"
  | "percent"
  | "integer"
  | "string";
export type ElectricalType =
  | "input"
  | "output"
  | "bidirectional"
  | "tri_state"
  | "passive"
  | "power_in"
  | "power_out"
  | "power"
  | "open_collector"
  | "open_emitter"
  | "no_connect"
  | "unspecified";
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;

/**
 * 一个 .teda component 文件的语义投影。引脚在 IR 里必须已物化：内联的照抄；`symbol` 指向自带引脚事实的第三方库、文件省略 `pins` 时由解析器从库展开，`pins_source` 记录来源。自建 `symbol` 只存视图、不带引脚事实（ADR-0012），所以指向自建符号的器件必须内联 `pins`。
 */
export interface Component {
  ir_version: IrVersion;
  format?: FormatVersion;
  source?: SourceRef;
  component: {
    /**
     * 等于文件名（去扩展名），不是相对路径。
     */
    id: string;
    mpn?: string;
    manufacturer?: string;
    /**
     * 开放取值集：mcu / resistor / capacitor / inductor / led / diode / mosfet_p / regulator / battery_charger / …。只做分类与免 mpn 判定。
     */
    category?: string;
    package: string;
    datasheet?: string;
    /**
     * 嘉立创商城料号，见 ADR-0006。
     */
    lcsc?: string;
    symbol: LibraryRef;
    footprint: LibraryRef;
    /**
     * 声明 instances 行允许的额外列，顺序即列序；required 必须排在 optional 之前（teda.md §12）。
     */
    params?: ParamDecl[];
    /**
     * @minItems 1
     */
    pins: [Pin, ...Pin[]];
    /**
     * inline = 文件里有 pins 段（内联优先）；symbol = 文件省略 pins，引脚从自带引脚事实的第三方库解析（自建 symbol 不带引脚事实，不能成为这个来源）。两者同时存在时取 inline，差异由校验报告输出，不进 IR。
     */
    pins_source: "inline" | "symbol";
  };
  note?: Note;
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
export interface ParamDecl {
  name: string;
  type: ParamType;
  required: boolean;
}
export interface Pin {
  /**
   * 与封装 pad 对应的键；是身份的一部分。
   */
  number: string;
  /**
   * 功能名，人可读；复用功能写在 alternates。
   */
  name: string;
  electrical_type: ElectricalType;
  /**
   * 多单元器件的单元号；缺省 1。
   */
  unit?: number;
  /**
   * 复用功能名，如 GPIO0/BOOT 里的 BOOT。
   */
  alternates?: string[];
}
