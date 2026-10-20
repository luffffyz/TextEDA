// 从 schemas/ir/<version>/*.schema.json 生成两样东西，都落在 src/generated/：
//   1. schemas.ts —— 内联后的 schema 文档（Ajv 与浏览器共用，运行时不需要读文件）
//   2. types/*.ts  —— TS 类型（json-schema-to-typescript）
// 生成是幂等的：同样的 schema 得到逐字节相同的产物；CI 用 `git diff --exit-code` 兜住漂移。
import { compile } from "json-schema-to-typescript";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const irVersion = process.env.IR_VERSION ?? "v0.1";
const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, "../../../schemas/ir", irVersion);
const outDir = join(here, "../src/generated");

const files = readdirSync(schemaDir)
  .filter((f) => f.endsWith(".schema.json"))
  .sort();

const common = JSON.parse(readFileSync(join(schemaDir, "common.schema.json"), "utf8"));
const commonId: string = common.$id;
const commonRef = `${commonId}#/$defs/`;

// 跨文件 $ref 用 $id（URN）表达，是契约的一部分；生成 TS 类型前把它内联成 #/$defs/…，
// 因为类型生成器按文件路径解析 $ref，不认识 URN。
function inlineCommonRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(inlineCommonRefs);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith(commonRef)) {
        out.$ref = value.replace(commonRef, "#/$defs/");
      } else {
        out[key] = inlineCommonRefs(value);
      }
    }
    return out;
  }
  return node;
}

const ROOT_NAMES: Record<string, string> = {
  project: "Project",
  component: "Component",
  schematic: "Schematic",
  pcb: "Pcb",
  system: "System",
  manifest: "Manifest",
  footprint: "Footprint",
  symbol: "Symbol",
  common: "Common",
};

const kinds: string[] = [];
const documents: unknown[] = [];
const outputs: { path: string; content: string }[] = [];

for (const file of files) {
  const kind = file.replace(".schema.json", "");
  const raw = JSON.parse(readFileSync(join(schemaDir, file), "utf8"));

  // 分片里出现 common 的 $defs 时合并进来（名字不冲突：契约侧已保证）。
  // 注意用重写后的副本：raw.$defs 里的 URN 引用还没改写，会盖掉已改写的版本。
  const rewritten = inlineCommonRefs(raw) as Record<string, unknown>;
  const merged = kind === "common" ? raw : {
    ...rewritten,
    $defs: { ...(common.$defs ?? {}), ...(rewritten.$defs ?? {}) },
  };

  // 根类型名由 title 决定，契约里的 title 是中文说明；这里换成 kind 的 PascalCase，
  // 让生成的类型叫 Schematic / Component / … 而不是 TextEDAIRV01Schematic。
  if (kind !== "common") {
    (merged as Record<string, unknown>).title = ROOT_NAMES[kind] ?? kind;
  }

  documents.push(merged);
  kinds.push(kind);

  const ts = await compile(merged, kind, {
    bannerComment: "",
    additionalProperties: false,
    style: { semi: true, singleQuote: false, printWidth: 100 },
  });
  outputs.push({
    path: join(outDir, "types", `${kind}.ts`),
    content: `// 由 packages/ir/scripts/generate.ts 从 schemas/ir/${irVersion} 生成，不要手改。\n${ts}`,
  });
}

// 运行时用的 schema 文档：顺序固定，Ajv 按 $id 注册。
outputs.push({
  path: join(outDir, "schemas.ts"),
  content: [
    "// 由 packages/ir/scripts/generate.ts 生成，不要手改。",
    `// 来源：schemas/ir/${irVersion}/（${kinds.join(" · ")}）`,
    `export const irVersion = ${JSON.stringify(irVersion.replace(/^v/, ""))};`,
    `export const schemaKinds = ${JSON.stringify(kinds)} as const;`,
    "export const schemas: readonly Record<string, unknown>[] = [",
    ...documents.map((d) => `  ${JSON.stringify(d)},`),
    "];",
    "",
  ].join("\n"),
});

// --check：只比对不写。CI 用它挡住“改了 schema 却忘了重新生成”。
const check = process.argv.includes("--check");
const drifted: string[] = [];
for (const { path, content } of outputs) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) continue;
  if (check) {
    drifted.push(path);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

if (check) {
  if (drifted.length > 0) {
    console.error("生成的产物与 schema 不一致，请跑 `bun run gen`：");
    for (const path of drifted) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log(`generated artifacts up to date (${outputs.length} files)`);
} else {
  console.log(`generated ${kinds.length} schemas + types into ${outDir}`);
}
