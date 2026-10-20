# reference-project

由 `textEDA init` 生成并补齐的参考工程。

```
reference-project/
├── project.toml        # 项目元数据
├── symbols/project/    # 自建符号库：一份符号一个 .teda（视图，引脚事实在 components/）
├── footprints/project/ # 自建封装库：一份封装一个 .teda（几何真源）
├── components/         # 器件描述，按类别分子目录
│   ├── indicators/
│   ├── mcu/
│   ├── passives/
│   ├── power/
│   ├── regulators/
│   └── sensors/
├── sch/                # 原理图描述：板根 sch/<board_id>.teda，板内页面 sch/<board_id>/<page_id>.teda
├── pcb/                # PCB 描述，可后置；本工程有一份试跑夹具 charger-buck.teda
├── system/             # 多板连接描述，一份系统一个文件（本工程暂无）
└── docs/               # 设计文档、评审记录、仿真结论
```

## components/

- `component_id` 取文件名（不含 `.teda`），不是相对路径：`components/passives/r-0402.teda` ↔ `r-0402`。
- 子目录只做分类；同一 `component_id` 在 `components/` 树内必须唯一。
- 描述料号、封装、库符号/封装、引脚表；`pins` 指向自建符号时必填，指向自带引脚事实的第三方库时可省略、由库解析（内联优先）。
- `params` 声明该器件在 `instances` 行里允许的额外列；行的列语义由被引用器件决定。
- `sch` 只引用 id，不内联定义器件；找不到文件即报错。
- 不联网取库；`<lib>:` 前缀解析本地库（本工程只有 `project:`），失败即报错。
- 本工程**全部自建**：`symbols/project/` + `footprints/project/` 是源，`project.toml` 的 `[libs.project]` 用内容哈希锁版本。库级校验：`bun run lib:verify`（每个器件都能解析、每个库文件都能编译/导出/被 KiCad 读入、全部封装合并板 DRC 干净）。
- 示例：`tps7a02`（SOT-23-5，`components/regulators/`）、`tps7a2033pdbvr`（SOT-23-5，`components/regulators/`）、`tps5430ddar`（HSOIC-8，`components/regulators/`）、`r-0402`（通用电阻，`components/passives/`）、`xtal-8mhz-3225`（晶振，`components/passives/`）、`sw-ts-1187`（轻触开关，`components/mechanical/`）、`ch32v307vct6`（LQFP-100，`components/mcu/`）、`bq24610rger`（VQFN-24，`components/power/`）。
- `components/` 是器件库：不是每个料都已经在板上用了（如 `ch32v307vct6`、`tps7a02` 目前没有板引用），库与板分开管。

## docs/

- `datasheets/`：器件规格书的**本地副本目录**，**不入库**（`.gitignore` 已排除；厂商 PDF 受版权保护，不随仓库分发）。文件名与器件对应（`tps7a20.pdf` 服务于 `tps7a2033pdbvr`），需要时按 `mcu-board-components.md` 里的表自行从厂商官网下载。器件一律从 datasheet 建，引脚与参数以本地副本为准；器件文件里的 `datasheet` 字段只记原始 URL。
- `mcu-board-components.md`：MCU 板器件选型、负载电容/电流预算等关键计算与待决项。

## sch/

`instances` 行 = `ref component_id [params...]`：

```
instances
  R1  r-0402  10k  ±1%
  U1  tps7a02
```

封装不在 `instances` 行里写，它由 `components/passives/r-0402.teda` 决定。

`mcu-board.teda` 是单页板根（`version 0.2`，只用 `ports`）：CH32V307VCT6 最小系统 + TPS7A2033PDBVR 3.3V LDO，5V 进、3V3 出，SWD 走板级端口。器件选型与计算见 `mcu-board-components.md`。一页放得下就不拆页。

`charger-buck.teda` 是板根：`BQ24610 充电/电源路径 + TPS5430 5V buck`，**一块物理板**，共用一份 BOM、一个 PCB。板上画不下、评审也要分块看，所以拆成两个页面：

```
pages
  M1  charger-power
  M2  buck-5v
```

- `sch/charger-buck/charger-power.teda`：BQ24610 3-cell 充电器/电源路径示例，器件值取自 SLUS892D Figure 20（19V 适配器、4A 输入限流、3A 充电、0.3A 预充/终止、5 小时定时）。
- `sch/charger-buck/buck-5v.teda`：TPS5430DDAR 5V/3A step-down 示例，输入取 `SYS`（9–19.8V），器件值取自 SLVS632 Figure 7-1。
- 页面内的 `net` 与 `refdes` 是**局部**的：只在页面内唯一。页面用 `ports` 段把节点暴露给板级，端口是唯一的跨界机制：

  ```
  ports
    GND      GND
    SYS_OUT  SYS
  ```

- 板根用 `M1.SYS_OUT` 这样的写法把页面端口接到板级 `net`：

  ```
  nets
    GND:  M1.GND  M2.GND
    SYS:  M1.SYS_OUT  M2.SYS_IN
  ```

- **展平**：板 = 板根实例 + 每个页面实例化一次后的实例。ERC 与 BOM 都在展平结果上跑——所以这块板只有一份 BOM。
- **BOM 计数**：BOM 行 = (`component_id`, 参数字典, 变体状态)，聚合键**不含** `refdes`。两个页面里的同型号件合并成一行、数量相加。板内 `refdes` 允许重复（跨页各叫各的），导出时重编为板级唯一。
- 板级 `ports` 段声明这块板的对外端子（`DC_IN` / `DC_RET` / `BAT` / `VOUT_5V` / `GND`）；`SYS` 是板内轨，不对外。
- 决策记录见仓库的 `docs/adr/0002-board-pages-and-bom.md`，语法见 `teda.md` §7.5–§7.7。

## pcb/

`pcb/charger-buck.teda`（`version 0.4`）是 **KiCad 导出链的试跑夹具**，不是 `charger-buck` 板的量产 PCB：

- 只放置了 `M2`（buck-5v）页的 9 个器件；`M1`（charger-power）页的器件未放置，按 `spec/pcb.md` §5.2 规则 1 视为变体状态（不贴）。量产 PCB 必须放置全部实例。
- 实例 ID 用展平后的形式 `M2.U1`；net 名用展平后的名字：板级 `GND` / `SYS` / `VOUT`，页内 `M2.BOOT` / `M2.PH` / `M2.VFB`（规则见仓库 `docs/adr/0007-page-internal-net-naming.md`）。
- `place` / `connect` / `trace` / `via` 的坐标是一次性原型算出来后固化的；IR 只存显式几何，连通性由 `connect` 段与 sch 决定。
- 试跑基线（DRC 报告、Gerber 清单、KiCad 工程文件）见仓库 `docs/trial-run/charger-buck/`；IR → KiCad 的字段级映射见 `docs/kicad-pcb-format.md`。

## 约定

- `project.toml` 是项目入口，`[project].name` 与目录名默认一致。
- 所有描述文件统一 `.teda` 扩展名，首行区分 `component` / `schematic` / `pcb` / `system` / `page`。
- `sch/`、`pcb/`、`system/` 按**描述类型**分目录，不按板分目录；同一块板在 `sch/` 与 `pcb/` 使用同名文件（`charger-buck.teda`），靠目录区分。板内页面例外，放 `sch/<board_id>/<page_id>.teda`。
- 一块板 = 一份 BOM、一个 PCB。页面只是板内的划分单元，不要把页面当独立板写进 `[boards]`。
- 文件头版本各自声明：用到 `pages` / `page` 的文件是 `version 0.3`，用到 `ports` 的是 `0.2`，其余保持 `0.1`；`[project].format` 记工程用到的最高版本。
- `pcb/` 可以为空；缺 PCB 描述时跳过 sch↔pcb 绑定校验，并在报告中标注“未校验”。
- `variants` 里的器件引用用稳定 `component_id`，不用 refdes。
- 设计文档与仿真证据放 `docs/`，结论绑定到它验证的设计版本。

## 下一步

1. 板根放 `sch/<board_id>.teda`，页面放 `sch/<board_id>/<page_id>.teda`；一页放得下就不要分。
2. 需要物理实现时，在 `pcb/` 下创建同名文件。
3. 板对外接口定下来后，在对应 net 上加连接器件；`ports` 与板根不用改。
4. 运行 `textEDA check`（尚未实现）验证。
