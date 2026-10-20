# ADR-0009：实现栈（TypeScript + Bun）、渲染分层与 IDE 集成面

状态：已接受
日期：2026-10-20
影响范围：`AGENTS.md` §1.1、§8、§9、§11 第 13 条、§12；`docs/adr/0004-ir-representation.md` 决策 2；`schemas/ir/`

## 背景

`AGENTS.md` §11 第 13 条（Rust 还是 Python/TS）一直挂着。现在三个需求把它逼定：

1. **跨平台渲染**：同一份图要在 CLI（终端主机）、编辑器 webview、浏览器、CI 里都能出。
2. **IDE 插件**：诊断、补全、跳转要跑在编辑器扩展宿主里。
3. **3D 封装**：要能读 STEP、三角化、在 webview 里交互查看。

用户已定用 **Bun** 作为工具链。Bun 解决了 CLI 与测试，但**它不是**编辑器扩展宿主（VS Code/Electron 是 Node）、也不是 webview（浏览器）。所以决定的是"语言 + 工具链"，不是"运行时只有 Bun"——这条区别写进下面的决策 1，否则第一个插件就会写出只能跑 Bun 的代码。

## 决策

### 1. TypeScript strict + ESM；Bun 是工具链，不是唯一运行时

| 角色 | 运行时 | 说明 |
|---|---|---|
| CLI（`textEDA`）与 CI | **Bun** | `bun build --compile` 出单文件二进制；`bun test` 跑测试 |
| IDE 扩展宿主 | **Node ≥ 20** | VS Code / 其他 LSP 客户端都是 Node |
| 渲染与 3D 视图 | **浏览器 / WebView** | webview 与未来 web 版同一套代码 |
| `packages/core` | **三者皆可** | 纯函数：只吃字符串/字节，不碰文件系统、网络、时钟、随机源 |

硬规则：

- `packages/core` 与 `packages/ir` **禁止** `Bun.*`、禁止 `node:fs`/`node:path` 之外的 Node 内建（fs/path 只允许出现在 CLI/导出层）、禁止 `process.env`。
- 包全部 ESM，`exports` 指向 ESM，浏览器可打包（无顶层副作用）。
- 字节级确定性不依赖运行时：同一输入在不同运行时产出同一 canonical JSON（哈希一致）。

### 2. 契约链只有一份：JSON Schema → TS 类型；不引入 zod

修订 ADR-0004 决策 2 的 zod 部分：

- 唯一契约仍是 `schemas/ir/<version>/*.schema.json`。
- 运行时校验器**直接吃这些 schema 文件**（Ajv 2020-12，构建期内联成常量），不做第二份校验代码。
- TS 类型由 schema 生成（`json-schema-to-typescript`），产物放 `packages/ir/src/generated/`，CI 检查"重新生成无 diff"。
- **结论：不引入 zod。** ADR-0004 担心的"zod 与 JSON Schema 双份定义漂移"从根上消失，代价是类型生成多一步构建。

  两者的机制差别（写给后来的读者）：

  | | JSON Schema + Ajv | zod |
  |---|---|---|
  | 规则怎么写 | 独立的 `.schema.json` 文件 | TS 代码：`z.object({...})` |
  | 运行时校验 | Ajv 读那份文件 | zod 自己生成的函数 |
  | TS 类型 | 从 schema **生成**（`json-schema-to-typescript`） | 从代码**推导**（`z.infer`），零生成步骤 |
  | 跨语言 | 任何语言都能读同一份文件 | 只有 TS 能用 |

  zod v4 有 `z.toJSONSchema()`，所以"用 zod 写、再导出 schema 给别人"是可行的——代价是**契约的真源变成 TS 代码**，与 ADR-0004"JSON Schema 是唯一契约"冲突，且 Rust/Python 实现者要读生成物而不是源。若将来要换，正确的换法是**改 ADR-0004 把真源改成 zod 代码**，而不是在现有结构里再加一层。

### 3. 渲染分层：SVG 是唯一权威派生；位图/PDF 只做导出

| 形态 | 归属 | 理由 |
|---|---|---|
| **SVG**（sch / pcb） | S1 / B1 权威派生 | 文本、可 diff、可哈希、任何宿主都能显示（CLI 可转、webview 直显、浏览器直开） |
| PNG / PDF | 导出时才生成 | 由 SVG 转（resvg / 宿主能力），不进版本库 |
| glTF（3D 装配） | B1 派生 | 交互查看，由 STEP 三角化而来 |
| STEP | 借（器件库/导出） | 不自研几何内核 |

所有渲染器遵守 `extract(render(ir)) == ir`（§2 第 4 条）；SVG 输出必须确定性（同 IR 同字节），这样"冻结产物 + 哈希"才成立。

### 4. 3D：两条路，按用途分流（已实测）

| 用途 | 手段 | 实测结果 |
|---|---|---|
| 报告/CI 里的 3D 快照 | `kicad-cli pcb render` | KiCad 10 有该命令；800×450 PNG，渲染 0.036 s。**本机没装 3D 模型库时只出裸板 + 丝印**（实测：box 内有铜、丝印、无器件本体） |
| webview 里交互查看 | OCCT WASM → 三角化 → three.js | `replicad@1.1.0` + `replicad-opencascadejs@1.1.0` 在 Bun 下跑通：`makeBox` → `mesh` 72 顶点/36 三角面；`blobSTEP` 15 KB → `importSTEP` → 重新三角化通过 |

#### 许可与替代方案（实测，2026-10-20）

JS 生态里**能读 STEP 的都嵌了 OCCT**，换包不换许可级别；真正的差别是"要不要在运行时带 CAD 内核"：

| 方案 | 许可 | 体积 | 实测 |
|---|---|---|---|
| `replicad` + `replicad-opencascadejs@1.1.0`（2026-09 维护） | MIT 封装 + **LGPL-2.1-only** 的 OCCT | wasm 22 MB | Bun 下跑通：`makeBox` → `mesh` 72 顶点/36 三角面；`blobSTEP` 15 KB → `importSTEP` → 重新三角化通过 |
| `occt-import-js@0.0.23`（只做导入：STEP/IGES/BREP → 网格） | **LGPL-2.1** | wasm **7.3 MB** | Bun 下跑通：同一个 STEP → 1 个网格、24 顶点/12 三角面 |
| `opencascade.js@1.1.1`（2020-09，停滞） | LGPL-2.1-only | 66.7 MB | 未测；只有 `2.0.0-beta.*` 在动 |
| `three@0.186` + `GLTFLoader` / `VRMLLoader` | MIT | — | KiCad 自带 `.wrl` 模型可直接读，不需要 CAD 内核 |
| `manifold-3d@3.5` | Apache-2.0 | 2.8 MB | 纯几何/CSG，**不读 STEP** |
| `kicad-cli pcb render`（外部程序） | KiCad 本体 GPL-3.0 | — | 只调用、不链接、不分发 |

**路由决策（按"运行时是否带 LGPL"分层）：**

- **路径 A（默认）离线转 glTF**：STEP 在构建期转成 `.glb` 存进工程资产，运行时只有 three.js（MIT）+ `GLTFLoader`。转换器是构建期依赖，不进分发物 → **分发物里没有 LGPL**。
- **路径 B KiCad `.wrl` 直读**：KiCad 官方 3D 模型就是 VRML，three.js 的 `VRMLLoader` 直接读 → 同样零 CAD 内核。
- **路径 C（兜底）运行时转 STEP**：只有厂商 STEP 模型才需要，用 `occt-import-js`（7.3 MB，比 replicad 小 3 倍、比 opencascade.js 小 9 倍）。许可级别与其它 OCCT 方案相同：**LGPL-2.1**。

**LGPL 在 wasm 下的合规做法**（若最终走路径 C）：wasm 作为**独立文件**随包分发、运行时动态 `import()` 加载（不静态合并进 bundle）、不修改其源码、随包附许可证与对应源码/构建说明。满足这些即满足 LGPL 的"可替换、可重新链接"要求；违反的典型写法是把 wasm 二进制塞进单文件 bundle 或改写它。

- **体积预算**：7.3 MB 的 wasm 只进 3D 视图，按需 `import()`；CLI 冷启动不受影响。
- 3D **不参与连通性判定、不回写 IR**（§2 第 2、3 条）。镜像/装配检查只看几何。

### 5. IDE 集成面：LSP 是唯一入口，插件是薄壳

- 语言服务 = **LSP over stdio**：诊断（沿用 `teda.md` §11 的 `file:line:col: severity code: message`）、补全、悬停、跳转、格式化（`fmt`）。
- 图与 3D 走 **webview** 消费 `dist/ir/`（或 LSP 扩展请求），**插件不自己解析 `.teda`**。
- VS Code 扩展先做；其他 IDE 复用同一个 LSP，不为每个 IDE 写一套语义。
- 插件里禁止出现第二套语义实现：诊断文案来自核心检查器，插件只做展示。

### 6. 仓库结构（目标，替换 AGENTS.md §9 的占位）

```
textEDA/
├── packages/
│   ├── ir/         # schema → TS 类型 + Ajv 校验
│   ├── core/       # parser → IR → checks（纯函数）
│   ├── render/     # SVG（sch / pcb）
│   ├── exporter/   # KiCad / netlist / BOM（调 kicad-cli）
│   ├── lsp/        # 语言服务
│   ├── cli/        # textEDA 命令（Bun 编译）
│   └── vscode/     # VS Code 扩展（薄壳）
├── schemas/ir/     # 契约（唯一真源）
├── tests/          # 单元 + conformance + binding + round-trip + schemas
└── examples/       # 参考工程 + 十用例
```

## 后果

- **core 不能图省事用 Bun API**：换来的是插件与 web 版不必重写一遍核心；代价是核心层只能用标准 API（`TextEncoder`、`URL`、`structuredClone`…）。
- **没有 zod**：少一层依赖与一套一致性测试；代价是类型生成进构建链，生成物要进 CI 的"无 diff"检查。
- **SVG 优先**：位图/PDF 是导出层的事，"渲染"本身只有一种权威形态；代价是复杂特效（阴影、渐变）不能靠画布 API 随便加。
- **3D 是可选依赖**：22 MB 的 wasm 与 KiCad 3D 模型库都不进主链路；代价是"3D 里看到的东西"依赖外部模型库可用性（本机实测已暴露这一点）。
- **LGPL 边界**：默认路径（A/B）分发物里没有 LGPL；走路径 C 时 3D 包只能动态加载、不改不并——这条限制必须在打包脚本里体现，否则会静默违反许可。
- **STEP 导入能力被推迟到路径 C**：代价是厂商 STEP 模型在实时预览前要先离线转换一次（构建期步骤）。

## 后续

- ~~`packages/` 的构建编排~~ **已定（随 `@texteda/ir` 落地）**：bun workspace + TS 项目引用；`packages/ir` 从 `schemas/ir/<version>/` 生成 `src/generated/{schemas.ts,types/*.ts}`，`bun run gen` 写、`bun run gen:check` 只比对；契约校验用 Ajv 直接吃 schema，类型由 `json-schema-to-typescript` 生成。
- 其余包（core / render / exporter / lsp / cli / vscode）的构建产物与发布形态，等第二个包落地时定。
- SVG 的确定性要求（浮点化整、`id` 生成）要写成渲染器规范，否则"同 IR 同字节"只是口号。字体这一项已解决：自带 Hershey 笔画字体、文字画成路径，不依赖系统字体（ADR-0014 决策 4）。
- `kicad-cli pcb render` 依赖 3D 模型库的环境约定（`KICAD*_3DMODEL_DIR` 或随工程携带）要在导出文档里写清。
- 3D 从 STEP 到 glTF 的转换是否离线预生成（进 `dist/`）还是 webview 里实时做，取决于 22 MB 的加载体验，下一轮实测。
