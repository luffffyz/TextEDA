// 由 packages/ir/scripts/generate.ts 从 schemas/ir/v0.1 生成，不要手改。
export type IrVersion = "0.1";
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;

/**
 * 分片清单与哈希：每个分片一个 sha256（算在 canonical JSON 字节上）；板哈希与项目哈希按规则复算，不落盘。见 ADR-0008 决策 5。
 */
export interface Manifest {
  ir_version: IrVersion;
  /**
   * 产生 IR 的工具版本；产物可追溯的另一半。
   */
  tool_version: string;
  /**
   * @minItems 1
   */
  shards: [
    {
      /**
       * 相对 dist/ir/ 的分片路径，如 boards/charger-buck/schematic.json。
       */
      path: string;
      /**
       * 该分片 canonical JSON 字节的 SHA-256。
       */
      sha256: string;
    },
    ...{
      /**
       * 相对 dist/ir/ 的分片路径，如 boards/charger-buck/schematic.json。
       */
      path: string;
      /**
       * 该分片 canonical JSON 字节的 SHA-256。
       */
      sha256: string;
    }[]
  ];
  /**
   * 项目哈希 = SHA-256(shards 按 path 排序后逐行 "<path>:<sha256>\n" 拼接)。板哈希用同一规则，取该板分片子集。
   */
  source_hash: string;
  note?: Note;
}
