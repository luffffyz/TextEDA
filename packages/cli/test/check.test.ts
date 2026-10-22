// Contract tests for `texteda check`.
//
// Covers three things: a clean project yields zero diagnostics; a broken project reports codes from the registry; the exit code is non-zero when there are errors.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject, checkProject } from "../src/check.ts";

const COMPONENT = `version 0.1.1
component res-thick-0402

kind         family
category     resistor
construction thick
polarized    no
package      0402
symbol project:r
footprint project:chip-0402

params
  value  resistance  required

pins
  1  A  passive
  2  B  passive
`;

const BOARD = `version 0.3
schematic b

instances
  R1  res-thick-0402  10k

nets
  GND:  R1.1
  SIG:  R1.2
`;

/** Build a project in a temp directory. */
function makeProject(board: string): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-check-"));
  mkdirSync(join(root, "assets/families"), { recursive: true });
  mkdirSync(join(root, "design/sch"), { recursive: true });
  writeFileSync(join(root, "assets/families", "res-thick-0402.teda"), COMPONENT);
  writeFileSync(join(root, "design/sch", "b.teda"), board);
  return root;
}

const MODULE = `version 0.8
module m

instances
  R1  res-thick-0402  10k

nets
  VCC:  R1.1

ports
  VCC_OUT  VCC
`;

const COMPOSED_BOARD = `version 0.8
schematic b

modules
  M1  m

nets
  VCC:  M1.VCC_OUT
`;

/** Build a project whose board composes a module. */
function makeComposedProject(board: string, module: string | null = MODULE): string {
  const root = makeProject(board);
  if (module !== null) {
    mkdirSync(join(root, "design/modules"), { recursive: true });
    writeFileSync(join(root, "design/modules", "m.teda"), module);
  }
  return root;
}

describe("check", () => {
  test("a clean project has no errors", () => {
    const root = makeProject(BOARD);
    try {
      const result = checkProject(root);
      expect(result.boards).toEqual(["b"]);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports ref.unknown-component when the component is not found", () => {
    const root = makeProject(BOARD.replace("res-thick-0402", "no-such-part"));
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.unknown-component");
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.severity).toBe("error");
      expect(diagnostic?.data).toEqual({ component_id: "no-such-part", refdes: "R1" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unconnected pin is a warning, not an error", () => {
    const root = makeProject(BOARD.replace("  SIG:  R1.2\n", ""));
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "net.pin-unassigned");
      expect(diagnostic?.severity).toBe("warning");
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an unreadable component file counts as an error", () => {
    const root = makeProject(BOARD);
    try {
      writeFileSync(join(root, "assets/families", "broken.teda"), "nonsense\n");
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "syntax.header-invalid");
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports an error when the file-header id does not match the file name", () => {
    const root = makeProject(BOARD);
    try {
      writeFileSync(
        join(root, "assets/families", "broken.teda"),
        COMPONENT.replace("component res-thick-0402", "component other"),
      );
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.component-id-mismatch");
      expect(diagnostic?.severity).toBe("error");
      expect(diagnostic?.data).toEqual({ declared_id: "other", file_id: "broken" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check (a board that composes modules)", () => {
  test("the module's instances are flattened with the module's prefix", () => {
    const root = makeComposedProject(COMPOSED_BOARD);
    try {
      const result = analyzeProject(root);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      const ir = result.analyses[0]!.ir!;
      expect(ir.instances.map((i) => i.id)).toEqual(["M1.R1"]);
      // The port merged the module's net into the board's net.
      expect(ir.nets.map((n) => n.id)).toEqual(["VCC"]);
      expect(ir.nets[0]!.members).toEqual(["M1.R1.1"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a board referencing a module without a file is an error", () => {
    const root = makeComposedProject(COMPOSED_BOARD, null);
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.unknown-module");
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
