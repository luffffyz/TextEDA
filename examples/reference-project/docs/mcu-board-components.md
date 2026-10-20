# MCU 板（mcu-board）器件选型

## 板子定位

- CH32V307VCT6 最小系统 + 3.3V LDO：5V 进、3.3V 出，预留 SWD（PA13/PA14）。
- 选型原则：每个器件的引脚与电气参数都能在**本地 datasheet** 里查到（`docs/datasheets/`），不从记忆或二手页面取值。

## datasheet 本地化

> `docs/datasheets/` 里的厂商 PDF **不入库**（受版权保护，`.gitignore` 已排除）。按下表文件名从厂商官网自行下载即可。

| 器件 | 本地文件 | 原始来源 |
|---|---|---|
| TPS7A2033PDBVR | `docs/datasheets/tps7a20.pdf` | TI SBVS348H（TPS7A20，2024-07 修订） |
| CH32V307VCT6 | `docs/datasheets/CH32V307DS0.pdf` | WCH V3.9（CH32V303/305/307/317 数据手册） |
| SST-3225/8.000M-12PF | `docs/datasheets/SST-3225-8M-12PF-10PPM.pdf` | 四川索斯特《承认书》 |
| TS-1187 | `docs/datasheets/TS-1187.pdf` | 硕方精密 TS-1187 系列规格书 |

## 器件选型表

| 位号 | 器件 | 料号 | 封装 | 值 / 参数 | 依据 | 库文件 |
|---|---|---|---|---|---|---|
| U1 | MCU | CH32V307VCT6 | LQFP-100 | — | CH32V307DS0 V3.9 表 3-1 引脚定义 | `components/mcu/ch32v307vct6.teda` |
| U2 | LDO 3.3V | TPS7A2033PDBVR | SOT-23-5 | 3.3V / 300mA | SBVS348H §4 引脚功能、§5.3 推荐工作条件 | `components/regulators/tps7a2033pdbvr.teda` |
| Y1 | 晶振 | SST-3225/8.000M-12PF | SMD-3225-4P | 8.000MHz，CL=12pF，±10ppm | 索斯特承认书 电气特性 / Connection 图 | `components/passives/xtal-8mhz-3225.teda` |
| SW1 | 轻触开关 | TS-1187 | SMD-5.2×5.2mm-4P | 常开，按下接通 | TS-1187 电路图（1-2、3-4 各成一组） | `components/mechanical/sw-ts-1187.teda` |
| C1–C7 | 去耦电容 | 0402 X7R 16V | 0402 | 100nF | 每个 VDD/VIO/VDDA 脚一颗 | `c-0402` |
| C8 | 3V3 轨储能 | 0402 X7R 10V | 0402 | 1µF | CH32V307DS0 V3.9 表 4-2：VDDA 必须与 VIO 相同 → VDDA 直连 3V3，1µF 作就近储能 | `c-0402` |
| C9 | LDO 输入 | 0402 X7R 10V | 0402 | 1µF | SBVS348H 脚注 2：CIN 有效值 ≥0.47µF | `c-0402` |
| C10 | LDO 输出 | 0402 X7R 10V | 0402 | 1µF | SBVS348H 脚注 3：COUT 有效值 0.47–200µF | `c-0402` |
| C11、C12 | 晶振负载 | 0402 C0G/NP0 | 0402 | 10pF | 负载电容匹配（见下） | `c-0402`（`dielectric C0G`） |
| C13 | NRST | 0402 | 0402 | 100nF | 工程惯例，datasheet 未规定 | `c-0402` |
| R1 | NRST 上拉 | 0402 | 0402 | 10k | 工程惯例，datasheet 未规定 | `r-0402` |
| R2 | BOOT0 下拉 | 0402 | 0402 | 10k | CH32V307DS0 V3.9 引脚注 5：BOOT0 未引出的芯片内部下拉，本芯片 BOOT0 已引出 | `r-0402` |
| R3 | 指示灯限流 | 0402 | 0402 | 1k | 3.3V → 绿光 LED | `r-0402` |
| D1 | 电源指示 | LTST-C190GKT | 0603 | 绿 | 库中已有 | `components/indicators/led-green.teda` |

去耦电容的落点（CH32V307DS0 表 3-1 引脚号）：VDD_5(11)、VDD_4(28)、VDD_2(75)、VIO_1(50)、VIO_3(100)、VDDA(22)、VREF+(21)。

## 关键计算

### 晶振负载电容

```
CL_eff = C1·C2/(C1+C2) + C_stray
C_stray = OSC_IN 输入电容 ≤5pF（CH32V307DS0 第 4 章 电气特性）+ PCB 走线杂散 ≈2pF ≈ 7pF
C1 = C2 = 10pF → C1·C2/(C1+C2) = 5pF → CL_eff = 5 + 7 = 12pF = 晶振 CL ✓
```

- 晶振 ESR ≤150Ω（承认书 §6）；MCU 侧 HSE 驱动电流 0.53mA @ 20pF 负载（CH32V307DS0 第 4 章 电气特性），150Ω 是上限值，起振余量不大；若实测起振困难，换 ESR ≤60Ω 的同 CL 型号。
- 负载电容选 C0G/NP0，X7R 的容值随温度/偏压漂移会把频偏带进时钟。

### LDO 输入/输出电容

- CIN：有效值 ≥0.47µF（SBVS348H 脚注 2），用 1µF X7R 0402（3.3V 偏压下有效值仍 >0.47µF）。
- COUT：有效值 0.47–200µF（脚注 3），用 1µF X7R 0402；X7R 在 3.3V 下 ESR 远小于 100mΩ 上限。

### 电流预算

| 项 | 典型值 | 来源 |
|---|---|---|
| MCU 运行 144MHz（外设全开） | 22.4mA | CH32V307DS0 表 4-6 |
| MCU 运行 144MHz（外设全关） | 12.4mA | 表 4-6 |
| MCU 运行 8MHz | 1.8mA | 表 4-6 |
| LDO 能力 | 300mA | SBVS348H §5.3 |

300mA 对 MCU 侧余量充足；USB HS PHY 的电流不在上述表内，若板上要跑 USB 需另算。

### 复位与启动

- 芯片内置 POR/PDR，外部复位电路只为调试与手动复位服务：NRST 10k 上拉 + 100nF 对地，按键直接下拉 NRST。
- BOOT0 必须外部 10k 下拉，否则上电瞬间浮空可能误进下载模式。
- VREF+ 与 VDDA 同接 3V3，VREF- 接 VSS（不使用 ADC 时 VDDA 必须与 VIO 相同，VREF+ 2.4–3.6V）。

## 原理图

`sch/mcu-board.teda`（`version 0.2`，单页板：一页放得下就不拆页）。

- **电源**：`VIN_5V`（板级端口 `DC_IN`）→ U2.IN 与 U2.EN（EN 直接接 IN，常开；datasheet 说 EN 内部有 500kΩ 下拉，默认关断）→ U2.OUT = `V3V3`；C9 贴 IN、C10 贴 OUT、C8 为 3V3 轨储能。
- **MCU 供电**：`V3V3` 供 VDD_2/VDD_4/VDD_5/VIO_1/VIO_3/VDDA/VBAT/VREF+，各配一颗 100nF（C1–C7）；VSSA 与各 VSS 接地，VREF- 接地。
- **时钟**：Y1（1=OUT、3=IN、2/4=地）跨接 U1.OSC_OUT / U1.OSC_IN，C11/C12 各 10pF 对地。
- **复位与启动**：NRST = U1.NRST + R1(10k 上拉到 3V3) + C13(100nF 对地) + SW1(1/2 脚接 NRST，3/4 脚接地)；BOOT0 经 R2(10k) 下地。
- **指示灯**：3V3 → R3(1k) → D1(绿) → GND。
- **对外端口**：`DC_IN`、`VOUT_3V3`、`GND`、`SWDIO`(PA13)、`SWCLK`(PA14)、`NRST`、`BOOT0`。

已知 ERC 警告（预期内，不是错）：

- `SWDIO` / `SWCLK` 各只有一个成员——连接器器件入库后补第二端。
- 未用 GPIO 逐脚未连接——板级预留。

## 尚待决定

- **连接器**：5V 输入、3.3V 输出、SWD 排针——库里没有连接器器件，暂用板级 `ports` 表达，器件等确定后补库。
- **ESD/TVS**：5V 入口若要过 EMC 再加，型号取决于实际连接器。
- **USB**：CH32V307 带 USB HS/FS，是否上 USB 决定 ESD 与供电方案。
- **Y1 起振余量**：见上，必要时换低 ESR 型号。
- **PCB**：`pcb/` 下还没有本板的 PCB 描述，sch↔pcb 绑定校验暂缺。
