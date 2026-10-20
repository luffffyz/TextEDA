# IR v0.1 — 契约说明

这是 textEDA IR 的**唯一契约**：JSON Schema 2020-12。语义模型与落盘布局见 `docs/adr/0004-ir-representation.md`，分片、身份键、单位与哈希粒度见 `docs/adr/0008-ir-shard-identity-and-hash.md`，TS 类型由本目录生成、不引入 zod 见 `docs/adr/0009-implementation-stack.md`。

## 文件与 `$id`

| 文件 | `$id` | 对应源文件 |
|---|---|---|
| `common.schema.json` | `urn:texteda:ir:0.1:common` | 无（共享 `$defs`） |
| `project.schema.json` | `urn:texteda:ir:0.1:project` | `project.toml` |
| `component.schema.json` | `urn:texteda:ir:0.1:component` | `components/**/<id>.teda` |
| `schematic.schema.json` | `urn:texteda:ir:0.1:schematic` | `sch/<board_id>.teda` + `sch/<board_id>/<page_id>.teda`（展平后一份） |
| `pcb.schema.json` | `urn:texteda:ir:0.1:pcb` | `pcb/<board_id>.teda` |
| `system.schema.json` | `urn:texteda:ir:0.1:system` | `system/<system_id>.teda` |
| `manifest.schema.json` | `urn:texteda:ir:0.1:manifest` | 无（`dist/ir/manifest.json`） |

所有 schema 都是 **closed**（`additionalProperties: false`），枚举穷举；未知字段一律拒绝，不降级为警告。

## 序列化

canonical JSON，规则同 ADR-0004 决策 3：UTF-8 无 BOM、LF、末尾一个换行；键按码位升序；`snake_case`；**只有整数**；不写 `null`、不写空集合、不写时间戳与绝对路径；`source_hash = SHA-256(canonical 字节)`。

## 单位

字段名后缀即单位（`_nm`、`_mdeg`、`_mohm`、`_uv`、`_na`、`_uw`、`_mhz`、`_mdegc`、`_ppm`）；器件参数值（`params[].value`）的整数单位由器件声明里的参数类型决定（`resistance`→µΩ、`capacitance`→fF、`inductance`→pH …）。完整换算表见 ADR-0008 决策 4。

## 测

```sh
bun install
bun run gen        # 从本目录生成 packages/ir/src/generated（schema + TS 类型）
bun run gen:check  # 只比对：生成物与 schema 不一致就失败（CI 用）
bun test           # 契约正反例 + 类型层断言
bun run typecheck
```

- `tests/schemas/valid/<schema 名>/` 的每个夹具必须通过，`tests/schemas/invalid/<schema 名>/` 的必须失败（由 `packages/ir/test/contract.test.ts` 跑）。
- 运行时校验直接用 Ajv 吃这些 schema 文件，**没有第二份校验实现**；TS 类型由 schema 生成（`packages/ir/scripts/generate.ts`），生成物不手改。
- 夹具只证明 schema 自洽，不证明解析器正确；`source → IR` 的黄金文件随解析器一起落。
