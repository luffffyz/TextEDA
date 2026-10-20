// canonical JSON：ADR-0004 决策 3 的规则 1–9。
// 键按 Unicode 码位升序；只允许整数；缺省字段省略；不写时间戳、绝对路径、随机 id。
// 输出用 2 空格缩进（dist/ir/ 下的文件要能被人 diff），末尾一个换行。

export function canonicalJson(value: unknown): string {
  return `${render(value, 0)}\n`;
}

function render(value: unknown, indent: number): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`canonical JSON 不允许浮点：${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad(indent + 1)}${render(v, indent + 1)}`);
    return `[\n${items.join(",\n")}\n${pad(indent)}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (entries.length === 0) return "{}";
    const items = entries.map(
      ([k, v]) => `${pad(indent + 1)}${JSON.stringify(k)}: ${render(v, indent + 1)}`,
    );
    return `{\n${items.join(",\n")}\n${pad(indent)}}`;
  }
  throw new Error(`canonical JSON 不支持的类型：${typeof value}`);
}

function pad(indent: number): string {
  return "  ".repeat(indent);
}
