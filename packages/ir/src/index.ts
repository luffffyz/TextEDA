// IR 契约的运行时入口：schema 是唯一真源，这里直接用 Ajv 校验同一份 schema，
// 类型由 schema 生成（见 scripts/generate.ts）。不引入第二份校验实现。
//
// 运行时中立：只用 Web 标准 API 与 Ajv，不碰 Bun.*、不碰 process.env、不碰文件系统。
import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import { schemas, schemaKinds, irVersion } from "./generated/schemas.ts";

export { irVersion, schemaKinds };
export type SchemaKind = (typeof schemaKinds)[number];

export interface Diagnostic {
  /** JSON Pointer 路径，空串表示根。 */
  path: string;
  keyword: string;
  message: string;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // `anyOf: [{required:["rev"]},{required:["version"]}]` 这类“至少一个”惯用法
  // 会让 Ajv 误报 required 未在同层声明。
  strictRequired: false,
});

for (const schema of schemas) {
  ajv.addSchema(schema as AnySchema);
}

/** 按需编译：CLI 冷启动不必一次性编译六份 schema。 */
const validators: Partial<Record<SchemaKind, ValidateFunction>> = {};

function validatorFor(kind: SchemaKind): ValidateFunction {
  const cached = validators[kind];
  if (cached) return cached;
  const compiled = ajv.getSchema(`urn:texteda:ir:${irVersion}:${kind}`);
  if (!compiled) throw new Error(`没有 ${kind} 的 schema`);
  validators[kind] = compiled;
  return compiled;
}

/** 校验一份分片；诊断里的行列由调用方补（IR 不含行号，只有 `source` 指针）。 */
export function validate(kind: SchemaKind, data: unknown): { ok: boolean; errors: Diagnostic[] } {
  const validateFn = validatorFor(kind);
  if (validateFn(data)) return { ok: true, errors: [] };
  const errors: Diagnostic[] = (validateFn.errors ?? []).map((e: ErrorObject) => ({
    path: e.instancePath,
    keyword: e.keyword,
    message: e.message ?? "不合法",
  }));
  return { ok: false, errors };
}
