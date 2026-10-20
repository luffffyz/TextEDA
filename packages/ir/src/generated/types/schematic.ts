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
export type ParamValue =
  | {
      name: string;
      /**
       * 单位由器件 params 段声明的类型决定（resistance→µΩ 等，见 ADR-0008 决策 4）。
       */
      value: number;
    }
  | {
      name: string;
      text: string;
    };
/**
 * 该对象在源文件中的起始行，供诊断定位。
 */
export type ProxyLine = number;
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;
/**
 * <instance_id>.<pin_number>，如 M2.U1.4、M2.U1.PAD。
 */
export type PinRef = string;
/**
 * 展平后的 net 名即身份键：板级 net 用板根名（GND），页内 net 用 <page_instance_id>.<net>（M2.BOOT）。
 */
export type NetId = string;
export type Constraint =
  | {
      type: "voltage";
      subject: NetOrPinRef;
      min_uv: number;
      max_uv: number;
    }
  | {
      type: "current";
      subject: NetOrPinRef;
      max_na: number;
    }
  | {
      type: "power";
      subject: NetOrPinRef;
      max_uw: number;
    }
  | {
      type: "impedance";
      net: NetId;
      value_mohm: number;
    }
  | {
      type: "length";
      net: NetId;
      min_nm: number;
      max_nm: number;
    }
  | {
      type: "diff";
      net_a: NetId;
      net_b: NetId;
      impedance_mohm: number;
      tolerance_ppm?: number;
    }
  | {
      type: "skew";
      net_a: NetId;
      net_b: NetId;
      op: "<" | "<=" | ">" | ">=";
      length_nm: number;
    };
/**
 * subject 可以是 net（展平后名字）或引脚引用；两者同形，歧义由解析器按上下文判定。
 */
export type NetOrPinRef = string;

/**
 * 一块板的原理图 IR：板根 + 所有页面的展平结果。只有一份 instances / nets —— 展平即唯一表示，pages 只保留页面实例化关系。见 ADR-0007、ADR-0008 决策 2。
 */
export interface Schematic {
  ir_version: IrVersion;
  format: FormatVersion;
  source?: SourceRef;
  /**
   * 与 sch/<board_id>.teda、pcb/<board_id>.teda 共享的 board_id。
   */
  board: string;
  /**
   * 页面实例化关系，不是网表。缺省表示这块板没有分页。
   */
  pages?: Page[];
  instances: Instance[];
  nets: Net[];
  ports?: Port[];
  buses?: Bus[];
  constraints?: Constraint[];
  note?: Note;
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
export interface Page {
  /**
   * page_instance_id；与板根 refdes 共处板级命名空间。
   */
  id: string;
  /**
   * page_id，解析到 sch/<board_id>/<page_id>.teda。
   */
  page: string;
  /**
   * 页面源文件相对路径。
   */
  file: string;
}
export interface Instance {
  /**
   * 展平后的稳定实例 ID：板根 U1、页内 M2.U1。改名即换身份，见 ADR-0008 决策 3。
   */
  id: string;
  component: Slug;
  /**
   * 页内实例的 page_instance_id；板根实例省略。
   */
  page?: string;
  /**
   * 按器件 params 段声明的顺序排列；optional 列可省略。
   */
  params?: ParamValue[];
  dnp?: boolean;
  /**
   * 如 power flag：只存在于逻辑层，不产生物理实体。
   */
  logical_only?: boolean;
  line?: ProxyLine;
  note?: Note;
}
export interface Net {
  /**
   * 展平后的 net 名即身份键。
   */
  id: string;
  /**
   * 引脚引用，编号形式（U1.1），不是引脚名。单成员 net 合法但 ERC 警告。
   */
  members: PinRef[];
  note?: Note;
}
export interface Port {
  id: string;
  net: NetId;
  /**
   * 页面端口；省略 = 板级端口。port 不创建节点，只给已有 net 起对外名字。
   */
  page?: string;
}
export interface Bus {
  id: string;
  /**
   * v0.4 只有命名意义，不做协议校验。
   */
  type: string;
  nets: NetId[];
}
