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
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;

/**
 * 多板连接：板间系统级 net。成员只引用板的 port，不引用引脚，也不改写任何板的内部连通性。见 ADR-0001。
 */
export interface System {
  ir_version: IrVersion;
  format: FormatVersion;
  source?: SourceRef;
  system: Slug;
  /**
   * @minItems 1
   */
  boards: [
    {
      id: Slug;
    },
    ...{
      id: Slug;
    }[]
  ];
  nets: {
    /**
     * 系统级 net 名，独立于板内 net 名。
     */
    id: string;
    /**
     * @minItems 2
     */
    members: [string, string, ...string[]];
  }[];
  note?: Note;
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
