// `system` description parsing: `.teda` source → the system IR (spec/teda.md §8, ADR-0001).
//
// A system says how boards are connected to each other. It is **not** a parent of the boards: it
// references their ports and stops there. Nothing in this file rewrites a board's own
// connectivity — delete the system file and every board still stands on its own (invariant 15).
//
// Two levels, as everywhere else in this package:
//
//   - the document level reads the file on its own: the header, the sections, the rows as they
//     are written.
//   - the project level adds what only the project knows: whether a board exists, whether a port
//     is declared, whether two system nets pull the same port apart.
//
// Those checks belong to the checker, not to the parser.
import { irVersion } from "@texteda/ir";
import type { System } from "@texteda/ir/system";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { lex, type Line } from "./lexer.ts";
import { checkVersion, typeRange } from "./version.ts";

/** The `system` type exists since language 0.2 (spec/teda.md §8). */
const VERSION_RANGE = typeRange(2);

/** The two sections of a system file. */
export const SYSTEM_SECTIONS = ["boards", "nets"] as const;
export type SystemSection = (typeof SYSTEM_SECTIONS)[number];

/** A board id: the same shape as everywhere else (`common#/$defs/slug`). */
const BOARD_ID_RE = /^[a-z][a-z0-9-]*$/;

/** A system net name: independent of the in-board net names (spec/teda.md §8.2). */
const NET_ID_RE = /^[A-Za-z0-9_+-]+$/;

/** A port reference: `<board_id>.<port_id>`. */
const PORT_REF_RE = /^[a-z][a-z0-9-]*\.[A-Za-z0-9_+-]+$/;

export interface SystemParseOptions {
  /** File name, relative to the project root. */
  file: string;
}

export interface SystemParseResult {
  ok: boolean;
  ir?: System;
  diagnostics: Diagnostic[];
}

function error(
  file: string,
  line: number,
  col: number,
  code: Diagnostic["code"],
  message: string,
  extra?: { expected?: string; actual?: string; hint?: string },
): Diagnostic {
  return {
    severity: "error",
    code,
    message,
    location: { file, line, col },
    ...(extra?.expected !== undefined ? { expected: extra.expected } : {}),
    ...(extra?.actual !== undefined ? { actual: extra.actual } : {}),
    ...(extra?.hint !== undefined ? { hint: extra.hint } : {}),
  };
}

/** Read a system file on its own. */
export function parseSystem(text: string, options: SystemParseOptions): SystemParseResult {
  const { file } = options;
  const diagnostics: Diagnostic[] = [];
  const lines = lex(text);

  let index = 0;
  const nextMeaningful = (): Line | null => {
    while (index < lines.length) {
      const line = lines[index]!;
      index += 1;
      if (line.blank || line.comment) continue;
      return line;
    }
    return null;
  };

  const versionLine = nextMeaningful();
  if (!versionLine || versionLine.cells.length !== 2 || versionLine.cells[0]!.text !== "version") {
    diagnostics.push(error(file, versionLine?.number ?? 1, 1, "syntax.header-invalid", "the first line must be version <ver>"));
    return { ok: false, diagnostics };
  }
  const verdict = checkVersion(versionLine.cells[1]!.text, VERSION_RANGE, "system");
  if (!verdict.ok) {
    diagnostics.push(
      error(file, versionLine.number, versionLine.cells[1]!.col, verdict.code, verdict.message, verdict.hint ? { hint: verdict.hint } : undefined),
    );
  }

  const typeLine = nextMeaningful();
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== "system") {
    diagnostics.push(error(file, typeLine?.number ?? 1, 1, "syntax.header-invalid", "the second line must be system <system_id>"));
    return { ok: false, diagnostics };
  }
  const systemId = typeLine.cells[1]!.text;
  if (!BOARD_ID_RE.test(systemId)) {
    diagnostics.push(
      error(file, typeLine.number, typeLine.cells[1]!.col, "syntax.header-invalid", `not a valid system id: ${systemId}`, {
        expected: "a lower-case id, e.g. cabinet",
        actual: systemId,
      }),
    );
  }

  const boards: string[] = [];
  const nets: { id: string; members: string[] }[] = [];
  let section: SystemSection | null = null;
  /** The net the current row is adding members to (the `name:` rows and their continuations). */
  let currentNet: { id: string; members: string[] } | null = null;

  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.blank || line.comment) continue;

    if (line.cells.length === 1) {
      const name = line.cells[0]!.text;
      // A section header is one of the two section names; inside the `boards` section a
      // one-cell line is a board id, because a board list has one id per line.
      if (name === "boards" || name === "nets") {
        section = name;
        currentNet = null;
        continue;
      }
      if (section === "nets") {
        diagnostics.push(
          error(file, line.number, line.cells[0]!.col, "syntax.net-invalid", "a system net row is written as `NAME: <port> <port>…`", {
            expected: "NAME: <board_id>.<port_id> …",
            actual: name,
            hint: "a single word on its own is a section head; the only sections are `boards` and `nets`",
          }),
        );
        continue;
      }
      if (section !== "boards") {
        diagnostics.push(error(file, line.number, line.cells[0]!.col, "syntax.unknown-section", `unknown section: ${name}`));
        section = null;
        currentNet = null;
        continue;
      }
      // A board id.
      const cell = line.cells[0]!;
      if (!BOARD_ID_RE.test(cell.text)) {
        diagnostics.push(
          error(file, line.number, cell.col, "syntax.board-invalid", `not a valid board id: ${cell.text}`, {
            expected: "a lower-case id, e.g. amp",
            actual: cell.text,
          }),
        );
        continue;
      }
      if (boards.includes(cell.text)) {
        diagnostics.push(
          error(file, line.number, cell.col, "ref.duplicate-board", `the board \`${cell.text}\` is listed twice`, {
            actual: cell.text,
          }),
        );
        continue;
      }
      boards.push(cell.text);
      continue;
    }

    if (section === "boards") {
      for (const cell of line.cells) {
        if (!BOARD_ID_RE.test(cell.text)) {
          diagnostics.push(
            error(file, line.number, cell.col, "syntax.board-invalid", `not a valid board id: ${cell.text}`, {
              expected: "a lower-case id, e.g. amp",
              actual: cell.text,
            }),
          );
          continue;
        }
        if (boards.includes(cell.text)) {
          diagnostics.push(
            error(file, line.number, cell.col, "ref.duplicate-board", `the board \`${cell.text}\` is listed twice`, {
              actual: cell.text,
            }),
          );
          continue;
        }
        boards.push(cell.text);
      }
      continue;
    }

    if (section === "nets") {
      // `NAME: member member…` — the colon opens the row, the members follow.
      const first = line.cells[0]!;
      // A continuation row starts with a bare `:`; a named row is `NAME:`.
      if (first.text !== ":" && first.text.endsWith(":")) {
        const name = first.text.slice(0, -1);
        if (!NET_ID_RE.test(name)) {
          diagnostics.push(
            error(file, line.number, first.col, "syntax.net-invalid", `not a valid system net name: ${name}`, {
              expected: "letters, digits, `_`, `+` or `-`",
              actual: name,
            }),
          );
          continue;
        }
        if (nets.some((net) => net.id === name)) {
          diagnostics.push(
            error(file, line.number, first.col, "ref.duplicate-net", `the system net \`${name}\` is defined twice`, {
              actual: name,
            }),
          );
          continue;
        }
        currentNet = { id: name, members: [] };
        nets.push(currentNet);
        const members = line.cells.slice(1);
        for (const member of members) {
          if (!PORT_REF_RE.test(member.text)) {
            diagnostics.push(
              error(file, line.number, member.col, "syntax.port-ref-invalid", `not a valid port reference: ${member.text}`, {
                expected: "<board_id>.<port_id>",
                actual: member.text,
              }),
            );
            continue;
          }
          currentNet.members.push(member.text);
        }
        continue;
      }
      // A continuation row: the first cell is a bare `:`.
      if (first.text === ":" && currentNet) {
        for (const member of line.cells.slice(1)) {
          if (!PORT_REF_RE.test(member.text)) {
            diagnostics.push(
              error(file, line.number, member.col, "syntax.port-ref-invalid", `not a valid port reference: ${member.text}`, {
                expected: "<board_id>.<port_id>",
                actual: member.text,
              }),
            );
            continue;
          }
          currentNet.members.push(member.text);
        }
        continue;
      }
      diagnostics.push(
        error(file, line.number, first.col, "syntax.net-invalid", "a system net row is written as `NAME: <port> <port>…`", {
          expected: "NAME: <board_id>.<port_id> …",
          actual: line.text,
        }),
      );
      continue;
    }

    diagnostics.push(
      error(file, line.number, line.cells[0]!.col, "syntax.unknown-field", `unknown key: ${line.cells[0]!.text}`),
    );
  }

  if (section === null) {
    diagnostics.push(error(file, 1, 1, "syntax.unknown-section", "the file has no section"));
  }
  if (boards.length === 0) {
    diagnostics.push(
      error(file, 1, 1, "syntax.unknown-section", "a system needs at least one board in its `boards` section", {
        expected: "at least one board id",
        actual: "none",
      }),
    );
  }
  for (const net of nets) {
    if (net.members.length < 2) {
      diagnostics.push(
        error(file, 1, 1, "syntax.net-invalid", `the system net \`${net.id}\` needs at least two members`, {
          expected: "at least two port references",
          actual: `${net.members.length}`,
        }),
      );
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const ir: System = {
    ir_version: irVersion,
    format: verdict.ok ? verdict.text : "0.2",
    system: systemId,
    boards: boards.map((id) => ({ id })) as [{ id: string }, ...{ id: string }[]],
    nets: nets.map((net) => ({ id: net.id, members: net.members })) as {
      id: string;
      members: [string, string, ...string[]];
    }[],
  };
  return { ok: true, ir, diagnostics };
}
