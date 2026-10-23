// The system layer's rules (spec/teda.md §8, ADR-0001).
//
// A system says how boards are wired to each other. The rules here are the ones that need more
// than one file: the board must exist, the port must be declared, one board's net must not be
// pulled into two system nets, and the two sides of a connection must agree about the voltage.
//
// The system layer never rewrites a board: deleting the system file leaves every board standing
// on its own (invariant 15). That is why these are checks and not a transformation.
//
// Pure functions: they consume facts, touch no filesystem and know no syntax.
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { System } from "@texteda/ir/system";

export interface SystemFacts {
  /** The system's IR. */
  readonly system: System;
  /** The board ids the project declares (`project.toml`). */
  readonly declaredBoards: readonly string[];
  /** The board IRs by board id; a board without a schematic is not in the table. */
  readonly boards: ReadonlyMap<string, Schematic>;
}

/** A port of a board: the port name and the board net behind it. */
interface PortBinding {
  readonly port: string;
  readonly net: string;
}

/** The ports of a board, by port name. */
function portsOf(board: Schematic): Map<string, string> {
  const out = new Map<string, string>();
  for (const port of board.ports ?? []) out.set(port.id, port.net);
  return out;
}

/** The voltage interval a board declares for one of its nets, if it declares one. */
function voltageRange(board: Schematic, net: string): { min: number; max: number } | undefined {
  for (const constraint of board.constraints ?? []) {
    if (constraint.type !== "voltage") continue;
    if (constraint.subject !== net) continue;
    return { min: constraint.min_uv, max: constraint.max_uv };
  }
  return undefined;
}

function error(
  code: Diagnostic["code"],
  message: string,
  location: { file: string; line: number; col: number },
  extra?: { expected?: string; actual?: string; hint?: string },
): Diagnostic {
  return {
    severity: "error",
    code,
    message,
    location: { file: location.file, line: location.line, col: location.col },
    ...(extra?.expected !== undefined ? { expected: extra.expected } : {}),
    ...(extra?.actual !== undefined ? { actual: extra.actual } : {}),
    ...(extra?.hint !== undefined ? { hint: extra.hint } : {}),
  };
}

/**
 * Check a system against the project it belongs to.
 *
 * The file the diagnostics point at is the system file; the board it complains about is named in
 * the message.
 */
export function checkSystem(facts: SystemFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const file = facts.system.source?.file ?? "system";
  const declared = new Set(facts.declaredBoards);

  // The boards the system names must be boards of this project.
  for (const board of facts.system.boards) {
    if (!declared.has(board.id)) {
      diagnostics.push(
        error(
          "ref.unknown-system-board",
          `the system names the board \`${board.id}\`, which the project does not declare`,
          { file, line: 1, col: 1 },
          { actual: board.id, hint: "Declare the board in `[boards.<id>]` in project.toml" },
        ),
      );
      continue;
    }
    if (!facts.boards.has(board.id)) {
      diagnostics.push(
        error(
          "ref.unknown-system-board",
          `the system names the board \`${board.id}\`, which has no schematic`,
          { file, line: 1, col: 1 },
          { actual: board.id, hint: `Write the board's schematic as design/sch/${board.id}.teda` },
        ),
      );
    }
  }

  // The board net behind every port, so that a port can be resolved and a net can be traced.
  const bindings = new Map<string, PortBinding>();
  for (const [boardId, board] of facts.boards) {
    for (const [port, net] of portsOf(board)) bindings.set(`${boardId}.${port}`, { port, net });
  }

  // Which board net each system net pulls in, so that a net is not pulled apart.
  const netOwners = new Map<string, { board: string; net: string; systemNet: string }>();

  for (const net of facts.system.nets) {
    for (const member of net.members) {
      const separator = member.indexOf(".");
      const boardId = member.slice(0, separator);
      const portId = member.slice(separator + 1);
      if (!facts.boards.has(boardId)) continue;
      const binding = bindings.get(member);
      if (!binding) {
        diagnostics.push(
          error(
            "ref.unknown-system-port",
            `the board \`${boardId}\` declares no port \`${portId}\``,
            { file, line: 1, col: 1 },
            { actual: member, hint: `Declare the port in the board's ports section` },
          ),
        );
        continue;
      }
      // One board net may not end up in two system nets: that would short them together.
      const key = `${boardId}.${binding.net}`;
      const owner = netOwners.get(key);
      if (owner && owner.systemNet !== net.id) {
        diagnostics.push(
          error(
            "ref.system-net-conflict",
            `the board net \`${binding.net}\` of the board \`${boardId}\` is in the system nets \`${owner.systemNet}\` and \`${net.id}\``,
            { file, line: 1, col: 1 },
            { actual: key, hint: "One board net belongs to one system net" },
          ),
        );
        continue;
      }
      netOwners.set(key, { board: boardId, net: binding.net, systemNet: net.id });
    }
  }

  // The two sides of a connection must agree about the voltage: the intervals have to overlap.
  for (const net of facts.system.nets) {
    const ranges: { board: string; net: string; min: number; max: number }[] = [];
    for (const member of net.members) {
      const separator = member.indexOf(".");
      const boardId = member.slice(0, separator);
      const board = facts.boards.get(boardId);
      if (!board) continue;
      const binding = bindings.get(member);
      if (!binding) continue;
      const range = voltageRange(board, binding.net);
      if (!range) continue;
      ranges.push({ board: boardId, net: binding.net, min: range.min, max: range.max });
    }
    if (ranges.length < 2) continue;
    const lowest = ranges.reduce((a, b) => (a.min <= b.min ? a : b));
    const highest = ranges.reduce((a, b) => (a.max >= b.max ? a : b));
    if (lowest.max < highest.min) {
      diagnostics.push(
        error(
          "bind.system-voltage-mismatch",
          `the system net \`${net.id}\` connects voltage ranges that do not overlap: the lowest maximum is ${lowest.max} µV and the highest minimum is ${highest.min} µV`,
          { file, line: 1, col: 1 },
          {
            actual: `${lowest.max}..${highest.min}`,
            hint: "Check the voltage constraints of the boards the system net connects",
          },
        ),
      );
    }
  }

  return diagnostics;
}
