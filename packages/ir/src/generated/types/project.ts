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
 * 库锁定：必须有 rev、version、content_hash 之一，保证可复现。自建库用 symbols/footprints（或旧写法 path）+ content_hash。
 */
export type Lib = Lib1 & {
  id: LibId;
  /**
   * 库来源：上游名或地址（kicad-official、仓库 URL），项目自建库写 project。
   */
  source: string;
  rev?: string;
  version?: string;
  /**
   * 只有一个根的自建库的项目相对目录（旧写法），如 footprints/project。两个根时用 symbols + footprints。
   */
  path?: string;
  /**
   * 项目自建库的符号目录（项目相对路径），如 symbols/project。与 footprints 共用同一个 <lib>: 命名空间，见 ADR-0010 补充与 ADR-0012。
   */
  symbols?: string;
  /**
   * 项目自建库的封装目录（项目相对路径），如 footprints/project。
   */
  footprints?: string;
  /**
   * 自建库的内容哈希：SHA-256(库目录内文件按相对路径排序后逐行 "<relpath>:<file_sha256>\n" 拼接)。见 ADR-0010 决策 2。
   */
  content_hash?: string;
};
export type Lib1 = {
  [k: string]: unknown;
};
/**
 * 库名（project.toml 的 [libs.<name>] 表名），允许下划线，如 project。
 */
export type LibId = string;
/**
 * 自由文本；canonical JSON 没有注释，这是替代品（ADR-0004 规则 8）。
 */
export type Note = string;

/**
 * project.toml 的 IR 投影：人写的元数据 + 板/变体/库/合规清单。不含任何电路语义。见 ADR-0008 决策 6。
 */
export interface Project {
  ir_version: IrVersion;
  source?: SourceRef;
  project: {
    name: string;
    /**
     * 项目版本，不是语言版本。
     */
    version: string;
    format: FormatVersion;
    description?: string;
    /**
     * SPDX 标识。
     */
    license?: string;
    status?: "draft" | "prototype" | "frozen" | "production" | "deprecated";
    default_variant?: Slug;
    /**
     * @minItems 1
     */
    authors?: [
      {
        name: string;
        email?: string;
      },
      ...{
        name: string;
        email?: string;
      }[]
    ];
    links?: {
      repository?: string;
      homepage?: string;
      issues?: string;
    };
  };
  boards?: Board[];
  variants?: Variant[];
  libs?: Lib[];
  compliance?: Compliance;
  /**
   * 唯一的自由扩展区；未知顶层键一律报错（AGENTS.md §9）。
   */
  ext?: {};
  note?: Note;
}
export interface SourceRef {
  /**
   * 相对项目根的源文件路径，如 sch/charger-buck/buck-5v.teda。不写绝对路径。
   */
  file: string;
  line?: number;
}
export interface Board {
  id: Slug;
  revision?: string;
  title?: string;
}
export interface Variant {
  id: Slug;
  description?: string;
  /**
   * 不贴的 component_id 或实例 id；只影响 BOM 与制造，不改变连通性（AGENTS.md §11 第 8 条）。
   */
  dnp?: Slug[];
  nofit?: Slug[];
  alternates?: {
    from: Slug;
    to: Slug;
  }[];
}
export interface Compliance {
  standards?: string[];
  operating_temp?: {
    min_mdegc: number;
    max_mdegc: number;
  };
}
