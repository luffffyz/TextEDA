// canonical JSON: rules 1–9 of ADR-0005 decision 3.
// Keys sorted by Unicode code point ascending; integers only; default fields omitted; no timestamps, absolute paths, or random ids.
// Output uses 2-space indentation (files under dist/ir/ must be human-diffable), with a single trailing newline.

export function canonicalJson(value: unknown): string {
  return `${render(value, 0)}\n`;
}

function render(value: unknown, indent: number): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`canonical JSON does not allow floats: ${value}`);
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
  throw new Error(`canonical JSON unsupported type: ${typeof value}`);
}

function pad(indent: number): string {
  return "  ".repeat(indent);
}
