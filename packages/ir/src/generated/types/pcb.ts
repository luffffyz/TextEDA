// 由 packages/ir/scripts/generate.ts 从 schemas/ir/v0.1 生成，不要手改。
export type IrVersion = "0.1";
/**
 * 产生该分片的 .teda 文件的语言版本，见 teda.md §13。
 */
export type FormatVersion = string;
/**
 * component_id / board_id / page_id / system_id / variant id 的形态。
 */
export type Slug = string;
export type StackupLayer =
  | {
      layer: LayerName;
      type: "copper";
      thickness_nm: number;
      kind: "signal" | "power" | "plane";
    }
  | {
      layer: LayerName;
      type: "dielectric";
      thickness_nm: number;
      material: string;
      /**
       * 介电常数 × 10^6，如 FR4 4.3 = 4300000；省略表示未知。
       */
      er_ppm?: number;
    };
export type LayerName = string;
/**
 * 板根实例 U1；页内实例 <page_instance_id>.<refdes>，如 M2.U1。这就是身份键，见 ADR-0008 决策 3。
 */
export type InstanceId = string;
/**
 * pcb 的 pad 引用，与 pin_ref 同形；pad 号来自封装。
 */
export type PadRef = string;
/**
 * 展平后的 net 名即身份键：板级 net 用板根名（GND），页内 net 用 <page_instance_id>.<net>（M2.BOOT）。
 */
export type NetId = string;
export type Rule =
  | {
      type: "clearance";
      value_nm: number;
    }
  | {
      type: "width";
      value_nm: number;
    }
  | {
      type: "via";
      size_nm: number;
      drill_nm: number;
    }
  | {
      type: "net";
      net: NetId;
      clearance_nm: number;
      width_nm: number;
      via_size_nm: number;
      via_drill_nm: number;
    }
  | {
      type: "diff";
      net_a: NetId;
      net_b: NetId;
      impedance_mohm: number;
      gap_nm: number;
    }
  | {
      type: "match";
      net_a: NetId;
      net_b: NetId;
      max_delta_nm: number;
    }
  | {
      type: "mask";
      expansion_nm: number;
    }
  | {
      type: "paste";
      ratio_ppm: number;
      offset_nm: number;
    }
  | {
      type: "thermal";
      gap_nm: number;
      bridge_nm: number;
    }
  | {
      type: "min_width";
      value_nm: number;
    };
export type PhysicalOnly =
  | {
      id: string;
      type: "mounting";
      size_nm: number;
      drill_nm: number;
    }
  | {
      id: string;
      type: "fiducial";
      size_nm: number;
      layer: LayerName;
    }
  | {
      id: string;
      type: "test_point";
      net: NetId;
      size_nm: number;
    }
  | {
      id: string;
      type: "stitching";
      net: NetId;
      size_nm: number;
      drill_nm: number;
    }
  | {
      id: string;
      type: "cutout";
      x_nm: number;
      y_nm: number;
      w_nm: number;
      h_nm: number;
    };
export type Deviation =
  | {
      type: "net_tie";
      net_a: NetId;
      net_b: NetId;
    }
  | {
      type: "split_ground";
      net: NetId;
    };
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;

/**
 * 一块板的物理事实与规则意图（B0 层）。不存绘图参数、丝印排版、填充缓存与 UUID；连通性由 connect 与 schematic 决定，不从几何反推。见 ADR-0003、spec/pcb.md。
 */
export interface Pcb {
  ir_version: IrVersion;
  format: FormatVersion;
  source?: SourceRef;
  board: Slug;
  /**
   * 板总厚；与 stackup 各层厚度之和一致（阻焊与字符层不计）。
   */
  board_thickness_nm: number;
  /**
   * 顺序即从上到下，不排序。第一项与最后一项必须是铜层。
   *
   * @minItems 2
   */
  stackup: [StackupLayer, StackupLayer, ...StackupLayer[]];
  /**
   * 板框闭合折线（首尾自动闭合），只支持折线。坐标原点为板框包围盒左下角。
   *
   * @minItems 3
   */
  outline: [Point, Point, Point, ...Point[]];
  place: Placement[];
  /**
   * 显式声明哪两个 pad 之间有连续铜箔——连通性的真源之一。
   */
  connect: ConnectEdge[];
  trace?: Trace[];
  via?: Via[];
  zone?: Zone[];
  keepout?: Keepout[];
  /**
   * 设计规则必须进 IR：KiCad 把它们放在工程文件而不是板文件里，只拿 .kicad_pcb 的 agent 无法自查。
   */
  rules: Rule[];
  silk?: Silk[];
  physical_only?: PhysicalOnly[];
  deviation?: Deviation[];
  note?: Note;
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
export interface Point {
  x_nm: number;
  y_nm: number;
}
export interface Placement {
  instance_id: InstanceId;
  x_nm: number;
  y_nm: number;
  /**
   * 顺时针为正，毫度；按 360000 取模。
   */
  rot_mdeg: number;
  side: "top" | "bottom";
}
/**
 * 一对 pad 构成一条“有铜箔连通”的边；每对内部按字节序 a ≤ b。
 */
export interface ConnectEdge {
  a: PadRef;
  b: PadRef;
}
export interface Trace {
  net: NetId;
  layer: LayerName;
  width_nm: number;
  /**
   * @minItems 2
   */
  points: [Point, Point, ...Point[]];
}
/**
 * 省略 from_layer/to_layer = 通孔；给出时为盲孔/埋孔。
 */
export interface Via {
  net: NetId;
  x_nm: number;
  y_nm: number;
  size_nm: number;
  drill_nm: number;
  from_layer?: LayerName;
  to_layer?: LayerName;
}
/**
 * 只存意图（轮廓 + net + 层）；填充结果不入 IR，由轮廓 + 规则重算。
 */
export interface Zone {
  net: NetId;
  layer: LayerName;
  /**
   * @minItems 3
   */
  points: [Point, Point, Point, ...Point[]];
}
export interface Keepout {
  type: "no_track" | "no_pour" | "no_place" | "no_via";
  layer: LayerName;
  /**
   * @minItems 3
   */
  points: [Point, Point, Point, ...Point[]];
}
/**
 * 只声明出不出、多大、哪层；排版位置不进 IR。
 */
export interface Silk {
  item: "refdes" | "value";
  layer: "F.SilkS" | "B.SilkS";
  size_nm: number;
  mode: "show" | "hide";
}
