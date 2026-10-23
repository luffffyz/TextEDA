import { describe, expect, test } from "bun:test";
import { checkSystem } from "../src/system/rules.ts";
import type { Schematic } from "@texteda/ir/schematic";
import type { System } from "@texteda/ir/system";

const FILE = "design/system/cabinet.teda";

function board(id: string, ports: { port: string; net: string }[], voltages: { net: string; min: number; max: number }[] = []): Schematic {
  return {
    ir_version: "0.7",
    format: "0.9",
    board: id,
    instances: [],
    nets: [],
    ports: ports.map((entry) => ({ id: entry.port, net: entry.net })),
    constraints: voltages.map((entry) => ({
      type: "voltage" as const,
      subject: entry.net,
      min_uv: entry.min,
      max_uv: entry.max,
    })),
  };
}

function system(boards: string[], nets: { id: string; members: string[] }[]): System {
  return {
    ir_version: "0.7",
    format: "0.2",
    system: "cabinet",
    boards: boards.map((id) => ({ id })) as [{ id: string }, ...{ id: string }[]],
    nets: nets.map((net) => ({ id: net.id, members: net.members })) as {
      id: string;
      members: [string, string, ...string[]];
    }[],
  };
}

describe("the system layer", () => {
  test("a system that matches the project passes", () => {
    const boards = new Map<string, Schematic>([
      ["amp", board("amp", [{ port: "GND", net: "GND" }, { port: "SYS_IN", net: "SYS" }])],
      ["ctrl", board("ctrl", [{ port: "GND", net: "GND" }, { port: "SYS_OUT", net: "SYS" }])],
    ]);
    const diagnostics = checkSystem({
      system: system(["amp", "ctrl"], [{ id: "GND", members: ["amp.GND", "ctrl.GND"] }]),
      declaredBoards: ["amp", "ctrl"],
      boards,
    });
    expect(diagnostics).toEqual([]);
  });

  test("a board the project does not have is an error", () => {
    const diagnostics = checkSystem({
      system: system(["amp", "ghost"], []),
      declaredBoards: ["amp"],
      boards: new Map([["amp", board("amp", [])]]),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("ref.unknown-system-board");
  });

  test("a board without a schematic is an error", () => {
    const diagnostics = checkSystem({
      system: system(["amp", "ctrl"], []),
      declaredBoards: ["amp", "ctrl"],
      boards: new Map([["amp", board("amp", [])]]),
    });
    expect(diagnostics.some((d) => d.code === "ref.unknown-system-board")).toBe(true);
  });

  test("a port the board does not declare is an error", () => {
    const boards = new Map<string, Schematic>([
      ["amp", board("amp", [{ port: "GND", net: "GND" }])],
      ["ctrl", board("ctrl", [{ port: "GND", net: "GND" }])],
    ]);
    const diagnostics = checkSystem({
      system: system(["amp", "ctrl"], [{ id: "GND", members: ["amp.GND", "ctrl.NOPE"] }]),
      declaredBoards: ["amp", "ctrl"],
      boards,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("ref.unknown-system-port");
  });

  test("one board net may not be in two system nets", () => {
    const boards = new Map<string, Schematic>([
      ["amp", board("amp", [{ port: "GND", net: "GND" }])],
      ["ctrl", board("ctrl", [{ port: "GND", net: "GND" }, { port: "SYS", net: "SYS" }])],
    ]);
    const diagnostics = checkSystem({
      system: system(
        ["amp", "ctrl"],
        [
          { id: "GND", members: ["amp.GND", "ctrl.GND"] },
          { id: "OTHER", members: ["amp.GND", "ctrl.SYS"] },
        ],
      ),
      declaredBoards: ["amp", "ctrl"],
      boards,
    });
    expect(diagnostics.some((d) => d.code === "ref.system-net-conflict")).toBe(true);
  });

  test("the voltage ranges of the two sides have to overlap", () => {
    const boards = new Map<string, Schematic>([
      ["amp", board("amp", [{ port: "OUT", net: "V" }], [{ net: "V", min: 0, max: 5_000_000 }])],
      ["ctrl", board("ctrl", [{ port: "IN", net: "V" }], [{ net: "V", min: 9_000_000, max: 12_000_000 }])],
    ]);
    const diagnostics = checkSystem({
      system: system(["amp", "ctrl"], [{ id: "V", members: ["amp.OUT", "ctrl.IN"] }]),
      declaredBoards: ["amp", "ctrl"],
      boards,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("bind.system-voltage-mismatch");
  });

  test("overlapping voltage ranges pass", () => {
    const boards = new Map<string, Schematic>([
      ["amp", board("amp", [{ port: "OUT", net: "V" }], [{ net: "V", min: 4_850_000, max: 5_150_000 }])],
      ["ctrl", board("ctrl", [{ port: "IN", net: "V" }], [{ net: "V", min: 4_500_000, max: 5_500_000 }])],
    ]);
    const diagnostics = checkSystem({
      system: system(["amp", "ctrl"], [{ id: "V", members: ["amp.OUT", "ctrl.IN"] }]),
      declaredBoards: ["amp", "ctrl"],
      boards,
    });
    expect(diagnostics).toEqual([]);
  });

  test("a side without a voltage constraint says nothing, so nothing is checked", () => {
    const boards = new Map<string, Schematic>([
      ["amp", board("amp", [{ port: "OUT", net: "V" }], [{ net: "V", min: 0, max: 5_000_000 }])],
      ["ctrl", board("ctrl", [{ port: "IN", net: "V" }])],
    ]);
    const diagnostics = checkSystem({
      system: system(["amp", "ctrl"], [{ id: "V", members: ["amp.OUT", "ctrl.IN"] }]),
      declaredBoards: ["amp", "ctrl"],
      boards,
    });
    expect(diagnostics).toEqual([]);
  });
});
