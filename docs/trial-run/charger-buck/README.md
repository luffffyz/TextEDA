# 试跑记录：pcb 描述 → KiCad → DRC / Gerber

日期：2026-10-20 · 门：`docs/adr/0005-manufacturing-output.md` decision 8（试跑门）· KiCad 10.0.7

> **历史快照**：本目录记录的是**自建库落地之前**的一次试跑，板里的封装来自 KiCad 官方库（见本目录 `fp-lib-table` 里的 nix 路径）。参考工程自此全部自建（`docs/adr/0013-reference-project-self-built-libraries.md`），当前的库级闭环门槛是 `bun run lib:verify`；本目录的产物保留作为当时的证据，不代表现在的库。

## 试的是什么

`examples/reference-project` 的 `charger-buck` 板。输入是仓库里的 pcb 描述 `examples/reference-project/design/pcb/charger-buck.teda`（层：pcb / B0），
输出是本目录下的 KiCad 板文件、工程文件、DRC 报告与 Gerber 清单。

这块板**不是量产板**：sch 展平后有 `M1`（charger-power，60 个器件）与 `M2`（buck-5v，9 个器件）两个页面，
本描述只放置了 `M2` 页的 9 个器件，`M1` 页按 `spec/pcb.md` §5.2 规则 1 视为变体状态（不贴）。
它验证的是**链路**（描述 → KiCad → DRC → 制造文件），不是这块板的设计。

## 怎么跑

```sh
kicad-cli pcb drc --format json --severity-all --refill-zones -o drc.json charger-buck.kicad_pcb
kicad-cli pcb export gerbers --check-zones --output gerbers/ charger-buck.kicad_pcb
kicad-cli pcb export drill  --output drill/  charger-buck.kicad_pcb
```

`--check-zones` **必须带**：`.kicad_pcb` 里只写铺铜多边形，填充结果不在文件里；不带这个开关导出的 `B_Cu` 只有过孔、没有铜皮（实测：703 B → 1158 B，缺 `G36/G37` 填充区）。

板文件由**一次性原型**（未进仓库）从 `examples/reference-project/design/pcb/charger-buck.teda` 生成，导出器本体是 P2 的活。
本目录里的 `charger-buck.kicad_pcb` 与仓库里的输入逐字节一致（原型是确定性的：uuid 由内容派生）。

`charger-buck.kicad_pro` 必须与板文件同目录——**设计规则在工程文件里，不在 `.kicad_pcb` 里**（见 `docs/kicad-pcb-format.md`）。
`fp-lib-table` 同理：没有它，KiCad 会对每个封装报 `lib_footprint_issues`（9~10 条 warning），DRC 报告就不干净。

## 结果

| 项 | 结果 |
|---|---|
| DRC 违规 | **0**（`drc.json`：`violations: []`） |
| 未连接项 | **0**（`unconnected_items: []`）——connect 段与几何一致，展平网表被完整走通 |
| Gerber | 21 个文件（双层铜、阻焊、锡膏、丝印、装配/用户/eco 层、板框、courtyard、fab、`*.gbrjob`） |
| 钻孔 | 1 个 Excellon 文件（`charger-buck.drl`） |

板上有 6 个 net：板级 `GND` / `SYS` / `VOUT`，页内 `M2.BOOT` / `M2.PH` / `M2.VFB`（命名规则见 `docs/adr/0007-page-internal-net-naming.md`）。

## 这轮试跑查出来的东西

1. **IR 的 `rules` 段没有 `.kicad_pcb` 落点**——板文件里根本不含设计规则，DRC 跑的是 KiCad 默认值。
   规则必须写进 `.kicad_pro`（`design_settings.rules` + `net_settings.classes`）。
   已实测：把 `min_clearance` 改成 1.0mm 后 DRC 立刻报 40 条 `clearance` 违规 → 工程文件确实生效。
2. **页内 net 的命名缺口**（`docs/adr/0007-page-internal-net-naming.md`）：`teda.md` §7.7 原来写"页内 net 不参与板级 net"，
   而 pcb 又必须连它，两条规则放在一起无解；且两个页面各有同名 `PH`/`VFB`。已定命名规则并改了 `teda.md` §7.7、`spec/pcb.md` §5.1/§5.2。
3. **封装 pad 的角度是绝对角**：板文件里 pad 的 `at` 角度 = 库里的角度 + 实例旋转（已与 KiCad 官方模板板比对确认），
   而 pad 的**坐标**仍是封装局部坐标（未旋转）——位置与角度的旋转规则不一样，容易写错。
4. **库绑定要有落点**：封装在板文件里是内联的（`(footprint "LIB:NAME" ...)`），但 `LIB:NAME` 仍被 KiCad 当库引用去核对，
   没有 `fp-lib-table` 就报 `lib_footprint_issues`。
5. **铺铜填充不在板文件里**：`zone` 只写多边形，填充由 KiCad 算且不写回文件；`pcb export gerbers` 必须带 `--check-zones`，
   否则导出的背面铜只有过孔、没有铜皮。DRC 那边对应的是 `--refill-zones`。

## 没验到的（下一轮）

- **叠层没落进去**：`stackup` 段（铜厚、介质厚度、材料）在本轮只落了 `board_thickness` → `(general (thickness 1.6))`；
  完整叠层应写进 `.kicad_pro` 的 `design_settings.stackup`，本轮没做。
- **`mask` / `paste` / `thermal` / `min_width` 四个 rules 参数**没验：它们按 ADR 0005 decision 5 是**封装属性**与**zone 属性**，不是板级设置，落点要单独核。
- **板框**：本轮用 4 条 `gr_line` 拼矩形；多边形板框、`gr_rect`、圆角都没试。
- **槽孔、非镀通孔、双面器件、背面丝印**都没试（`physical_only` 段还没实现）。
- **Gerber 只验了文件齐全与可导出**，没有做 CAM 级检查（阻焊扩张、锡膏比例、孔环）。
- 布线是一次性原型算的，**不是**布局布线器；真实项目要接 freerouting / KiCad。
