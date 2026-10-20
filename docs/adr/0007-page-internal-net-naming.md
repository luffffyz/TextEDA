# ADR-0007：展平后的 net 集合与命名（页内 net 怎么办）

状态：已接受（2026-10-20）
日期：2026-10-20
影响范围：`teda.md` §7.7；`spec/pcb.md` §5.1、§5.2；修正 `docs/adr/0002-board-pages-and-bom.md`（页内 net 的板级可见性）

## 背景

- 页面是板内划分单元，板级 net 只通过页面 `ports` 可见（`docs/adr/0002-board-pages-and-bom.md`）。按 `teda.md` §7.7 原来的写法：**页面里不被任何 `port` 暴露的 net 是页面内部节点，不参与板级 net**。
- 试跑（`docs/trial-run/charger-buck/`）把 demo 的 `charger-buck` 板导出到 KiCad 时撞上了这个空档：
  - `buck-5v` 页的 `BOOT` / `PH` / `VFB` 三个 net 没被任何端口暴露 → 按原口径它们不是板级 net；
  - 但 pcb 必须连它们（`BOOT` 是 `U1.BOOT`↔`C2.1` 的自举回路），否则 `spec/pcb.md` §5.2 规则 3/4 必然报错——`connect` 的两个 pad 不在同一个 net 里、且该 net 的成员 pad 没被任何 `connect` 对覆盖。
  - 也就是说：**"页内 net 不参与板级 net"与"pcb 只能引用已有 net"两条规则放在一起就无解**。
- 更棘手的是撞名：`charger-power` 页与 `buck-5v` 页**各有一个 `PH`、各有一个 `VFB`**，都是页内 net。同名但毫无关系，直接展平会并成一条 net，把两个页面的电路短在一起。
- 板级 net 名与页内 net 名是同一个命名空间（`spec/pcb.md` §5.1：net 的键是 `net_id` = net 名），所以展平后的 net 名必须唯一，且要能看出它属于哪一层。

## 决策

1. **展平后的 net 集合 = 板根声明的 net + 各页面里没有被板根引用的页内 net**。页内 net 不是"不存在"，而是"不并入板级 net"。
2. **被引用的页 net 并入板级 net，并改用板级 net 的名字**。板根写 `SYS: M1.SYS_OUT M2.SYS_IN`，则 `M1` 页的 `SYS` 与 `M2` 页的 `SYS` 都是展平后的 `SYS`；板根没写出来的页内 net 不会偷偷并进来。
3. **未被引用的页内 net 保留在展平结果里，名字是 `<page_instance_id>.<net>`**（如 `M2.BOOT`、`M1.PH`）。前缀是页面实例 ID，和实例 ID 的命名空间（`M1.R1`）一致。
4. **板级 net 名不得含 `.`**。否则板级名可能与页内 net 的命名空间形式重名，展平后无法区分。
5. **pcb 引用展平后的 net 名**：`trace` / `via` / `zone` / `deviation` 写 `M2.BOOT` 这种名字；`connect` 的一对 pad 可以落在同一个页内 net 内（它是展平后的一个 net，规则成立）。
6. **悬空端口（页面声明了端口，板根没引用）→ 警告**，该页的对应 net 保持页内命名，不并入任何板级 net。
7. **IR 语义不变**：IR 里 net 的身份键仍是 `net_id`（`AGENTS.md` §4.4），这条只约束表面语法的名字形式与展平算法。展平结果（net 集合 + 名字 + 成员）是 ERC、BOM、pcb 绑定校验的共同输入。

## 被否的方案

| 方案 | 为什么否 |
|---|---|
| 要求页内 net 名跨页唯一 | demo 自己就违反（两页各有 `PH`、`VFB`）；把作者逼到给页内 net 起全局怪名字（`BUCK5V_BOOT`），可读性更差 |
| 页内 net 完全不进 pcb / 不进展平 | pcb 无法表达自举回路这类页内连接，绑定校验必然失败（见背景） |
| pcb 里用"页实例 + 端口"代替 net 名引用 | 等于承认端口是连通性真源，违反"连通性只由逻辑模型（net）决定"（`AGENTS.md` §2 第 2 条） |
| 给每条展平 net 分配数字 ID，pcb 写 ID | 表面语法不可读、diff 不可读；`net_id` 属于 IR 层，名字才是表面形式 |

## 后果

- 展平后 net 名字带页面前缀是常态：`GND` / `SYS` / `VOUT` 是板级 net，`M2.BOOT` / `M2.PH` / `M2.VFB` / `M1.PH` 是页内 net。谁是板级的、谁是页内的，看名字就知道。
- 校验器必须实现展平（板根 + 页面 + 端口绑定），且 ERC、BOM、pcb 绑定校验共用同一个展平结果——这本来就是 `docs/adr/0002-board-pages-and-bom.md` 要求的"一份 BOM、一个 PCB"，现在只是把 net 也纳进来。
- 板根写错端口引用（写了 `M2.SYS_IN` 但 `M2` 页没有这个端口）仍然报错；板根漏写引用（页面端口没人接）变成悬空端口警告，页内 net 留在展平结果里。
- 代价：net 名不再全局"看起来像"电路里的信号名（`M2.BOOT` 比 `BOOT` 啰嗦）。这是把"名字唯一性"这件事从作者身上挪到工具身上的代价。

## 后续

- 写 conformance 用例：两个页面各有同名页内 net 的板，展平后 net 集合、名字与成员必须与本 ADR 一致。
- 展平结果要进 IR（`dist/ir/boards/<board_id>/schematic.json`）时，net 名字段与 `net_id` 的对应关系要写进 `schemas/`。
