// 从 `component` 描述里取出**导出符号需要的那几件事**：引脚表、footprint、datasheet、描述。
//
// 这不是 `component` 的解析器：完整的 component 解析（`params` 列类型、category/mpn 规则、
// lcsc 校验）还没落地（AGENTS.md §11）。本投影只读它需要的东西，且对读到的部分严格校验；
// 其余段与标量原样跳过，不假装校验过。
import type { Diagnostic } from "./diagnostics.ts";
import { lex } from "./lexer.ts";

/** `teda.md` §10.1 的引脚电气类型。 */
export const PIN_TYPES = new Set([
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "power_in",
  "power_out",
  "power",
  "open_collector",
  "open_emitter",
  "no_connect",
  "unspecified",
]);

export interface ComponentPinFact {
  number: string;
  name: string;
  type: string;
}

export interface ComponentFacts {
  id: string;
  pins: ComponentPinFact[];
  footprint?: string;
  datasheet?: string;
  description?: string;
}

export interface ComponentFactsResult {
  ok: boolean;
  facts?: ComponentFacts;
  diagnostics: Diagnostic[];
}

const PIN_NUMBER_RE = /^[A-Za-z0-9_+-]+$/;
const PIN_NAME_RE = /^[A-Za-z0-9_+-]+$/;

export function readComponentFacts(text: string, options: { file: string }): ComponentFactsResult {
  const { file } = options;
  const diagnostics: Diagnostic[] = [];
  const error = (line: number, col: number, code: string, message: string) => {
    diagnostics.push({ file, line, col, severity: "error", code, message });
  };

  const lines = lex(text);
  let index = 0;
  const next = () => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = next();
  if (!versionLine || versionLine.cells[0]?.text !== "version") {
    error(versionLine?.number ?? 1, 1, "C001", "第一行必须是 version <ver>");
    return { ok: false, diagnostics };
  }
  const typeLine = next();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "component") {
    error(typeLine?.number ?? 1, 1, "C001", "第二行必须是 component <id>");
    return { ok: false, diagnostics };
  }

  const facts: ComponentFacts = { id: typeLine.cells[1]!.text, pins: [] };
  let section: string | null = null;
  for (let line = next(); line !== null; line = next()) {
    if (line.cells.length === 1) {
      section = line.cells[0]!.text;
      continue;
    }
    if (section === null) {
      const key = line.cells[0]!.text;
      const value = line.cells.slice(1).map((c) => c.text).join(" ");
      if (key === "footprint") facts.footprint = value;
      else if (key === "datasheet") facts.datasheet = value;
      else if (key === "description") facts.description = value;
      continue;
    }
    if (section !== "pins") continue;
    if (line.cells.length < 3) {
      error(line.number, line.cells[0]!.col, "C002", "pins 行至少 3 列：number name type");
      continue;
    }
    const [number, name, type] = line.cells as [
      (typeof line.cells)[number],
      (typeof line.cells)[number],
      (typeof line.cells)[number],
    ];
    // 尾列是 `teda.md` §6.3 允许的可选列（unit / alt）；本投影用不到，但语法要校。
    let tailOk = true;
    for (const cell of line.cells.slice(3)) {
      const eq = cell.text.indexOf("=");
      const key = eq > 0 ? cell.text.slice(0, eq) : "";
      const value = eq > 0 ? cell.text.slice(eq + 1) : "";
      if (key === "unit") {
        if (!/^\d+$/.test(value) || Number(value) < 0) {
          error(line.number, cell.col, "C007", `unit 必须是非负整数：${value}`);
          tailOk = false;
        }
      } else if (key === "alt") {
        if (!PIN_NAME_RE.test(value)) {
          error(line.number, cell.col, "C007", `alt 不合法：${value}`);
          tailOk = false;
        }
      } else {
        error(line.number, cell.col, "C007", `未知引脚列：${cell.text}`);
        tailOk = false;
      }
    }
    if (!tailOk) continue;
    if (!PIN_NUMBER_RE.test(number.text)) {
      error(line.number, number.col, "C003", `引脚号不合法：${number.text}`);
      continue;
    }
    if (!PIN_NAME_RE.test(name.text)) {
      error(line.number, name.col, "C003", `引脚名不合法：${name.text}`);
      continue;
    }
    if (!PIN_TYPES.has(type.text)) {
      error(line.number, type.col, "C004", `未知电气类型：${type.text}`);
      continue;
    }
    if (facts.pins.some((p) => p.number === number.text)) {
      error(line.number, number.col, "C005", `引脚号重复：${number.text}`);
      continue;
    }
    facts.pins.push({ number: number.text, name: name.text, type: type.text });
  }

  // 自建符号只存视图（ADR-0012）：导出符号所需的引脚事实只能来自 component。
  if (facts.pins.length === 0) {
    error(1, 1, "C006", "pins 段不能为空：自建符号的引脚事实只能来自 component");
  }
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics };
  return { ok: true, facts, diagnostics };
}
