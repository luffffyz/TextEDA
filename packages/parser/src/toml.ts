// A small TOML reader for `project.toml`.
//
// The project has no runtime dependency, and `project.toml` needs none of TOML's corners: the
// project's own file carries metadata, tables and arrays of tables — no inline tables, no dates,
// no times. So this reader implements exactly that subset and **reports** everything outside it
// instead of guessing. "Best effort" parsing of a metadata file is worse than an error: a typo
// that is silently dropped becomes a missing board.
//
// The subset (AGENTS.md §9, "the keys project.toml allows"):
//   - comments: `#` to the end of the line
//   - tables: `[a.b]`, arrays of tables: `[[a.b]]`
//   - key = value, where the key is a bare key or a quoted string
//   - values: basic strings ("..." with the usual escapes), literal strings ('...'), integers,
//     floats, booleans, arrays (possibly spanning several lines)
//
// Everything else — inline tables, dates, dotted keys on the left of `=` — is an error with a
// line and a column.
import type { Diagnostic } from "@texteda/ir/diagnostics";

/** A value in a TOML document. */
export type TomlValue = string | number | boolean | TomlValue[];

/** A table in a TOML document. */
export interface TomlTable {
  [key: string]: TomlValue | TomlTable | TomlTable[];
}

export interface TomlParseResult {
  ok: boolean;
  value?: TomlTable;
  diagnostics: Diagnostic[];
}

interface Cursor {
  text: string;
  /** 0-based index into `text`. */
  pos: number;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  col: number;
}

function advance(c: Cursor): string {
  const ch = c.text[c.pos] ?? "";
  c.pos += 1;
  if (ch === "\n") {
    c.line += 1;
    c.col = 1;
  } else {
    c.col += 1;
  }
  return ch;
}

/** Skip spaces and tabs (not newlines). */
function skipSpaces(c: Cursor): void {
  while (c.pos < c.text.length) {
    const ch = c.text[c.pos]!;
    if (ch === " " || ch === "\t") advance(c);
    else break;
  }
}

/** Skip whitespace, comments and newlines. */
function skipToContent(c: Cursor): void {
  for (;;) {
    while (c.pos < c.text.length && /\s/.test(c.text[c.pos]!)) advance(c);
    if (c.text[c.pos] === "#") {
      while (c.pos < c.text.length && c.text[c.pos] !== "\n") advance(c);
      continue;
    }
    return;
  }
}

function error(c: Cursor, file: string, code: Diagnostic["code"], message: string): Diagnostic {
  return {
    severity: "error",
    code,
    message,
    location: { file, line: c.line, col: c.col },
  };
}

/** Parse a basic string ("..."): the usual escapes are understood, a newline ends the string. */
function parseBasicString(c: Cursor): string | undefined {
  // The opening quote has been seen by the caller.
  advance(c);
  let out = "";
  for (;;) {
    if (c.pos >= c.text.length) return undefined;
    const ch = advance(c);
    if (ch === '"') return out;
    if (ch === "\n") return undefined;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    if (c.pos >= c.text.length) return undefined;
    const esc = advance(c);
    switch (esc) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      default:
        return undefined;
    }
  }
}

/** Parse a literal string ('...'): no escapes at all. */
function parseLiteralString(c: Cursor): string | undefined {
  // The opening quote has been seen by the caller.
  advance(c);
  let out = "";
  for (;;) {
    if (c.pos >= c.text.length) return undefined;
    const ch = advance(c);
    if (ch === "'") return out;
    if (ch === "\n") return undefined;
    out += ch;
  }
}

/** Parse a number: an integer or a float, with the usual sign and underscores. */
function parseNumber(c: Cursor): number | undefined {
  const start = c.pos;
  const re = /^[+-]?(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?/;
  const rest = c.text.slice(c.pos);
  const m = re.exec(rest);
  if (!m) return undefined;
  for (let i = 0; i < m[0].length; i += 1) advance(c);
  const cleaned = m[0].replace(/_/g, "");
  const value = Number(cleaned);
  if (Number.isNaN(value)) {
    c.pos = start;
    return undefined;
  }
  return value;
}

/** Parse an array value: `[` ... `]`, elements separated by commas, possibly spanning lines. */
function parseArray(c: Cursor, file: string, diagnostics: Diagnostic[]): TomlValue[] | undefined {
  const out: TomlValue[] = [];
  for (;;) {
    skipToContent(c);
    if (c.pos >= c.text.length) {
      diagnostics.push(error(c, file, "format.toml-invalid", "the array is not closed"));
      return undefined;
    }
    if (c.text[c.pos] === "]") {
      advance(c);
      return out;
    }
    const value = parseValue(c, file, diagnostics);
    if (value === undefined) return undefined;
    out.push(value);
    skipToContent(c);
    if (c.text[c.pos] === ",") {
      advance(c);
      continue;
    }
    if (c.text[c.pos] === "]") {
      advance(c);
      return out;
    }
    diagnostics.push(
      error(c, file, "format.toml-invalid", "expected `,` or `]` in the array"),
    );
    return undefined;
  }
}

/** Parse one value. */
function parseValue(c: Cursor, file: string, diagnostics: Diagnostic[]): TomlValue | undefined {
  const ch = c.text[c.pos];
  if (ch === undefined) {
    diagnostics.push(error(c, file, "format.toml-invalid", "expected a value"));
    return undefined;
  }
  if (ch === '"') {
    const value = parseBasicString(c);
    if (value === undefined) {
      diagnostics.push(error(c, file, "format.toml-invalid", "the string is not closed"));
      return undefined;
    }
    return value;
  }
  if (ch === "'") {
    const value = parseLiteralString(c);
    if (value === undefined) {
      diagnostics.push(error(c, file, "format.toml-invalid", "the string is not closed"));
      return undefined;
    }
    return value;
  }
  if (ch === "[") {
    advance(c);
    return parseArray(c, file, diagnostics);
  }
  if (ch === "{") {
    diagnostics.push(
      error(c, file, "format.toml-invalid", "inline tables are not part of the subset this reader accepts"),
    );
    return undefined;
  }
  const rest = c.text.slice(c.pos);
  if (rest.startsWith("true")) {
    for (let i = 0; i < 4; i += 1) advance(c);
    return true;
  }
  if (rest.startsWith("false")) {
    for (let i = 0; i < 5; i += 1) advance(c);
    return false;
  }
  const value = parseNumber(c);
  if (value !== undefined) return value;
  diagnostics.push(error(c, file, "format.toml-invalid", "this value is not part of the subset this reader accepts"));
  return undefined;
}

/** Parse a key: a bare key or a quoted string. */
function parseKey(c: Cursor, file: string, diagnostics: Diagnostic[]): string | undefined {
  const ch = c.text[c.pos];
  if (ch === '"') {
    const value = parseBasicString(c);
    if (value === undefined) {
      diagnostics.push(error(c, file, "format.toml-invalid", "the key is not closed"));
      return undefined;
    }
    return value;
  }
  if (ch === "'") {
    const value = parseLiteralString(c);
    if (value === undefined) {
      diagnostics.push(error(c, file, "format.toml-invalid", "the key is not closed"));
      return undefined;
    }
    return value;
  }
  let out = "";
  while (c.pos < c.text.length && /[A-Za-z0-9_-]/.test(c.text[c.pos]!)) {
    out += advance(c);
  }
  if (out.length === 0) {
    diagnostics.push(error(c, file, "format.toml-invalid", "expected a key"));
    return undefined;
  }
  return out;
}

/** Split a table header path on the dots that are not inside a quoted key. */
function splitPath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (const ch of path) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ".") {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

/** Whether a value is a list of tables (an array of tables, not an array of values). */
function isTableArray(value: TomlValue | TomlTable | TomlTable[]): value is TomlTable[] {
  return (
    Array.isArray(value) &&
    value.every((v): v is TomlTable => typeof v === "object" && !Array.isArray(v))
  );
}

/** Find or create the table at `path` below `root`. */
function tableAt(root: TomlTable, path: string[]): TomlTable | undefined {
  let current: TomlTable = root;
  for (const part of path) {
    const next = current[part];
    if (next === undefined) {
      const created: TomlTable = {};
      current[part] = created;
      current = created;
      continue;
    }
    if (Array.isArray(next)) {
      const last = next[next.length - 1];
      if (last === undefined || typeof last !== "object" || Array.isArray(last)) return undefined;
      current = last;
      continue;
    }
    if (typeof next !== "object" || Array.isArray(next)) return undefined;
    current = next;
  }
  return current;
}

/** Read a TOML document. */
export function parseToml(source: string, options: { file: string }): TomlParseResult {
  const file = options.file;
  const diagnostics: Diagnostic[] = [];
  const root: TomlTable = {};
  const c: Cursor = { text: source, pos: 0, line: 1, col: 1 };

  let current: TomlTable = root;
  /** The table path of the current header, used in the diagnostics. */
  let currentPath: string[] = [];

  for (;;) {
    skipToContent(c);
    if (c.pos >= c.text.length) break;
    if (c.text[c.pos] === "[") {
      advance(c);
      const isArray = c.text[c.pos] === "[";
      if (isArray) advance(c);
      const start = c.pos;
      while (c.pos < c.text.length && c.text[c.pos] !== "]" && c.text[c.pos] !== "\n") advance(c);
      const raw = c.text.slice(start, c.pos).trim();
      if (c.text[c.pos] !== "]") {
        diagnostics.push(error(c, file, "format.toml-invalid", "the table header is not closed"));
        break;
      }
      advance(c);
      if (isArray) {
        if (c.text[c.pos] !== "]") {
          diagnostics.push(error(c, file, "format.toml-invalid", "the table header is not closed"));
          break;
        }
        advance(c);
      }
      const path = splitPath(raw);
      if (path.length === 0 || path.some((part) => part.length === 0)) {
        diagnostics.push(error(c, file, "format.toml-invalid", "the table header is empty"));
        break;
      }
      currentPath = path;
      if (isArray) {
        const parent = tableAt(root, path.slice(0, -1));
        if (parent === undefined) {
          diagnostics.push(error(c, file, "format.toml-invalid", `the table \`${path.join(".")}\` is nested in something that is not a table`));
          break;
        }
        const key = path[path.length - 1]!;
        const existing = parent[key];
        const created: TomlTable = {};
        if (existing === undefined) {
          parent[key] = [created];
        } else if (isTableArray(existing)) {
          existing.push(created);
        } else {
          diagnostics.push(error(c, file, "format.toml-invalid", `the table \`${path.join(".")}\` is defined twice`));
          break;
        }
        current = created;
        continue;
      }
      const table = tableAt(root, path);
      if (table === undefined) {
        diagnostics.push(error(c, file, "format.toml-invalid", `the table \`${path.join(".")}\` is nested in something that is not a table`));
        break;
      }
      current = table;
      continue;
    }

    // key = value
    const key = parseKey(c, file, diagnostics);
    if (key === undefined) break;
    skipSpaces(c);
    if (c.text[c.pos] !== "=") {
      diagnostics.push(error(c, file, "format.toml-invalid", `expected \`=\` after the key \`${key}\``));
      break;
    }
    advance(c);
    skipSpaces(c);
    const value = parseValue(c, file, diagnostics);
    if (value === undefined) break;
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      diagnostics.push(
        error(
          c,
          file,
          "format.toml-invalid",
          `the key \`${key}\` is defined twice${currentPath.length > 0 ? ` in \`${currentPath.join(".")}\`` : ""}`,
        ),
      );
      break;
    }
    current[key] = value;
  }

  return { ok: diagnostics.length === 0, value: root, diagnostics };
}

/** Read a table as a plain record of values (no nested tables). */
export function tableValue(table: TomlTable | undefined, key: string): TomlValue | undefined {
  if (!table) return undefined;
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value as TomlValue[];
  return undefined;
}

/** Read a nested table. */
export function subTable(table: TomlTable | undefined, key: string): TomlTable | undefined {
  if (!table) return undefined;
  const value = table[key];
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}
