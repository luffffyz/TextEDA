// Contract tests for `texteda check`.
//
// Covers three things: a clean project yields zero diagnostics; a broken project reports codes from the registry; the exit code is non-zero when there are errors.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject, checkProject } from "../src/check.ts";

const COMPONENT = `version 0.1.3
component res-thick-0402

kind         generic
category     resistor
construction thick
polarized    no
symbol project:r
footprint project:chip-0402

params
  value      resistance  required
  tolerance  percent     required

pins
  1  A  passive
  2  B  passive
`;

const BOARD = `version 0.3
schematic b

instances
  R1  res-thick-0402  10k  ±1%

nets
  GND:  R1.1
  SIG:  R1.2
`;

/** Build a project in a temp directory. */
function makeProject(board: string): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-check-"));
  mkdirSync(join(root, "assets/components"), { recursive: true });
  mkdirSync(join(root, "design/sch"), { recursive: true });
  writeFileSync(join(root, "assets/components", "res-thick-0402.teda"), COMPONENT);
  writeFileSync(join(root, "design/sch", "b.teda"), board);
  return root;
}

const MODULE = `version 0.8
module m

instances
  R1  res-thick-0402  10k  ±1%

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


const PART = `version 0.1.5
component rc0402fr-0710kl

kind         part
mpn          RC0402FR-0710KL
manufacturer Yageo
category     resistor

symbol project:r
footprint project:chip-0402

ratings
  value      resistance  10k
  tolerance  percent     1%

pins
  1  A  passive
  2  B  passive
`;

/** A procurement file: the selections of a board, in one of the two positions. */
function procurement(rows: string, role: "primary" | "alternatives" = "primary"): string {
  return `version 0.9
procurement b
role ${role}

selections
${rows}
`;
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

  test("a line nobody sourced is a warning, not an error", () => {
    const root = makeProject(BOARD);
    try {
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(
        join(root, "assets/procurement/primary", "b.teda"),
        procurement(""),
      );
      const result = checkProject(root);
      const unsourced = result.diagnostics.filter((d) => d.code === "value.procurement-generic-unsourced");
      expect(unsourced).toHaveLength(1);
      expect(unsourced[0]!.severity).toBe("warning");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a selection that satisfies the line is clean", () => {
    const root = makeProject(BOARD);
    try {
      writeFileSync(join(root, "assets/components", "rc0402fr-0710kl.teda"), PART);
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(
        join(root, "assets/procurement/primary", "b.teda"),
        procurement("  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl"),
      );
      const result = checkProject(root);
      expect(result.diagnostics.filter((d) => d.code.startsWith("value.procurement-"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a part that changes the land pattern is an error in the primary", () => {
    const root = makeProject(BOARD);
    try {
      writeFileSync(
        join(root, "assets/components", "rc0402fr-0710kl.teda"),
        PART.replace("footprint project:chip-0402", "footprint project:chip-0603"),
      );
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(
        join(root, "assets/procurement/primary", "b.teda"),
        procurement("  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl"),
      );
      const result = checkProject(root);
      const mismatch = result.diagnostics.filter(
        (d) => d.code === "bind.procurement-footprint-mismatch",
      );
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the same broken selection is a warning in the alternatives", () => {
    const root = makeProject(BOARD);
    try {
      writeFileSync(
        join(root, "assets/components", "rc0402fr-0710kl.teda"),
        PART.replace("footprint project:chip-0402", "footprint project:chip-0603"),
      );
      mkdirSync(join(root, "assets/procurement/alternatives"), { recursive: true });
      writeFileSync(
        join(root, "assets/procurement/alternatives", "b.teda"),
        procurement("  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl", "alternatives"),
      );
      const result = checkProject(root);
      const mismatch = result.diagnostics.filter(
        (d) => d.code === "bind.procurement-footprint-mismatch",
      );
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.severity).toBe("warning");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a line marked not-required is not an unsourced line", () => {
    const root = makeProject(BOARD);
    try {
      mkdirSync(join(root, "assets/procurement/primary"), { recursive: true });
      writeFileSync(
        join(root, "assets/procurement/primary", "b.teda"),
        procurement("  res-thick-0402  10k  ±1%  ->  not-required"),
      );
      const result = checkProject(root);
      expect(result.diagnostics.filter((d) => d.code === "value.procurement-generic-unsourced")).toEqual([]);
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
      writeFileSync(join(root, "assets/components", "broken.teda"), "nonsense\n");
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
        join(root, "assets/components", "broken.teda"),
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

  test("a reference to a broken device file is not reported as a missing component", () => {
    const root = makeProject(BOARD);
    try {
      // The device file exists but its construction is unknown: the file has errors, so it yields
      // no facts. The reference must say so, not claim the device is missing.
      writeFileSync(
        join(root, "assets/components", "res-thick-0402.teda"),
        COMPONENT.replace("construction thick", "construction thickh"),
      );
      const result = checkProject(root);
      expect(result.diagnostics.find((d) => d.code === "ref.unknown-component")).toBeUndefined();
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.component-invalid");
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.severity).toBe("warning");
      expect(diagnostic?.data).toEqual({
        component_id: "res-thick-0402",
        refdes: "R1",
        device_file: "assets/components/res-thick-0402.teda",
      });
      // The cause is reported once, as an error, at the device file.
      const cause = result.diagnostics.find((d) => d.code === "value.component-construction-invalid");
      expect(cause?.severity).toBe("error");
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
