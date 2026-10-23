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

const PROJECT = `[project]
name = "demo"
version = "0.1.0"
format = "0.9"
`;

/** Build a project in a temp directory. */
function makeProject(board: string): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-check-"));
  mkdirSync(join(root, "assets/components"), { recursive: true });
  mkdirSync(join(root, "design/sch"), { recursive: true });
  writeFileSync(join(root, "project.toml"), PROJECT);
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

const BOARD_A = `version 0.3
schematic a

instances
  R1  res-thick-0402  10k  ±1%

nets
  GND:  R1.1
  V5:   R1.2

ports
  GND  GND
  V5   V5

constraints
  voltage V5 4.8V..5.2V
`;

const BOARD_B = `version 0.3
schematic b

instances
  R1  res-thick-0402  10k  ±1%

nets
  GND:  R1.1
  V5:   R1.2

ports
  GND  GND
  V5   V5

constraints
  voltage V5 4.8V..5.2V
`;

/** A project with two boards that a system wires together. */
function makeSystemProject(system: string, boardB: string = BOARD_B): string {
  const root = mkdtempSync(join(tmpdir(), "texteda-system-"));
  mkdirSync(join(root, "assets/components"), { recursive: true });
  mkdirSync(join(root, "design/sch"), { recursive: true });
  mkdirSync(join(root, "design/system"), { recursive: true });
  writeFileSync(
    join(root, "project.toml"),
    `[project]
name = "demo"
version = "0.1.0"
format = "0.9"

[boards.a]
[boards.b]
`,
  );
  writeFileSync(join(root, "assets/components", "res-thick-0402.teda"), COMPONENT);
  writeFileSync(join(root, "design/sch", "a.teda"), BOARD_A);
  writeFileSync(join(root, "design/sch", "b.teda"), boardB);
  writeFileSync(join(root, "design/system", "s.teda"), system);
  return root;
}

describe("check (a system that wires two boards together)", () => {
  const SYSTEM = `version 0.2
system s

boards
  a
  b

nets
  GND:  a.GND  b.GND
  V5:   a.V5   b.V5
`;

  test("a consistent system reports no errors", () => {
    const root = makeSystemProject(SYSTEM);
    try {
      const result = checkProject(root);
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a port the board does not declare is an error", () => {
    const root = makeSystemProject(SYSTEM.replace("b.V5", "b.NOPE"));
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.unknown-system-port");
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("two sides with disjoint voltage ranges are an error", () => {
    const root = makeSystemProject(
      SYSTEM,
      BOARD_B.replace("voltage V5 4.8V..5.2V", "voltage V5 1.0V..2.0V"),
    );
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "bind.system-voltage-mismatch");
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("one board net in two system nets is an error", () => {
    const root = makeSystemProject(
      SYSTEM.replace(
        "nets\n  GND:  a.GND  b.GND\n  V5:   a.V5   b.V5\n",
        "nets\n  GND:  a.GND  b.GND\n  V5:   a.V5   b.V5\n  EXTRA: a.GND  b.GND\n",
      ),
    );
    try {
      const result = checkProject(root);
      const diagnostic = result.diagnostics.find((d) => d.code === "ref.system-net-conflict");
      expect(diagnostic?.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("a skipped binding check is reported, not assumed (AGENTS.md §4.4 rule 6)", () => {
  test("a schematic without a pcb says the binding was not checked", () => {
    const root = makeProject(BOARD);
    try {
      const notes = checkProject(root).diagnostics.filter((d) => d.code === "bind.not-checked");
      expect(notes).toHaveLength(1);
      expect(notes[0]!.severity).toBe("note");
      expect(notes[0]!.data).toEqual({ board: "b", present: "sch", missing: "pcb" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a pcb without a schematic is read far enough to say so", () => {
    const root = makeProject(BOARD);
    try {
      mkdirSync(join(root, "design/pcb"), { recursive: true });
      writeFileSync(
        join(root, "design/pcb", "b.teda"),
        "version 0.4\npcb b\n\nboard_thickness 1.6mm\n\nstackup\n  1 copper F.Cu signal 0.035mm\n  2 core   core dielectric 1.53mm\n  3 copper B.Cu signal 0.035mm\n\noutline\n  0mm 0mm\n  50mm 0mm\n  50mm 36mm\n",
      );
      // Both descriptions present: nothing is skipped, so there is no such note.
      expect(checkProject(root).diagnostics.filter((d) => d.code === "bind.not-checked")).toEqual([]);
      // Drop the schematic: the pcb is now a lone description, which must not vanish silently.
      rmSync(join(root, "design/sch", "b.teda"));
      const notes = checkProject(root).diagnostics.filter((d) => d.code === "bind.not-checked");
      expect(notes).toHaveLength(1);
      expect(notes[0]!.data).toEqual({ board: "b", present: "pcb", missing: "sch" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("review rounds (ADR-0033 F33)", () => {
  const ROUND = "# Review of b, round 1\n\nTarget `board:b`. Roles: power.\n\n- power (2026-10-23): the rail has no margin.\n";

  /** Add `[project].owner` and an optional decision to a project built by `makeProject`. */
  function withReviews(root: string, owner: string | null, decision: string | null): void {
    if (owner !== null) {
      writeFileSync(join(root, "project.toml"), `${PROJECT.replace('format = "0.9"', `format = "0.9"\nowner = "${owner}"`)}`);
    }
    mkdirSync(join(root, "docs/reviews"), { recursive: true });
    writeFileSync(join(root, "docs/reviews", "b-sch-r1.md"), ROUND);
    if (decision !== null) writeFileSync(join(root, "docs/reviews", "b-sch-r1.decision.toml"), decision);
  }

  const decision = (owner: string) =>
    `target = "board:b"\nowner = "${owner}"\ndate = "2026-10-23"\nverdict = "deferred"\n`;

  test("notes with no decision are reported, and the notes stay out of the exit code", () => {
    const root = makeProject(BOARD);
    try {
      withReviews(root, "carol", null);
      const result = checkProject(root);
      const rounds = result.diagnostics.filter((d) => d.code === "review.round-unclosed");
      expect(rounds).toHaveLength(1);
      expect(rounds[0]!.data).toEqual({ round: "b-sch-r1", notes: 1, authors: "power" });
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a decision by the accountable person closes the round", () => {
    const root = makeProject(BOARD);
    try {
      withReviews(root, "carol", decision("carol"));
      expect(checkProject(root).diagnostics.filter((d) => d.code.startsWith("review."))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a decision by someone else is reported with both names", () => {
    const root = makeProject(BOARD);
    try {
      withReviews(root, "carol", decision("dave"));
      const mismatch = checkProject(root).diagnostics.filter((d) => d.code === "review.owner-mismatch");
      expect(mismatch).toHaveLength(1);
      expect(mismatch[0]!.data).toEqual({ round: "b-sch-r1", decision_owner: "dave", project_owner: "carol" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reviews without an owner cannot be closed", () => {
    const root = makeProject(BOARD);
    try {
      withReviews(root, null, null);
      const missing = checkProject(root).diagnostics.filter((d) => d.code === "review.owner-missing");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("library curation (ADR-0023: the shard set is the project's content)", () => {
  test("a device file nothing uses is reported, not silently kept", () => {
    const root = makeProject(BOARD);
    try {
      // The same file the board places, plus a candidate nobody places.
      writeFileSync(
        join(root, "assets/components", "ldo-abandoned.teda"),
        COMPONENT.replace("component res-thick-0402", "component ldo-abandoned").replace(
          "kind generic",
          "kind part\nmpn LDO1",
        ),
      );
      const result = checkProject(root);
      const unused = result.diagnostics.filter((d) => d.code === "library.device-unused");
      expect(unused).toHaveLength(1);
      expect(unused[0]!.severity).toBe("warning");
      expect(unused[0]!.message).toContain("ldo-abandoned");
      expect(unused[0]!.location?.file).toBe("assets/components/ldo-abandoned.teda");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a device that only a procurement file names is in use", () => {
    const root = makeProject(BOARD);
    try {
      // The board places `res-thick-0402`; the alternatives file names the part bought for it.
      writeFileSync(
        join(root, "assets/components", "rc0402-as-part.teda"),
        COMPONENT.replace("component res-thick-0402", "component rc0402-as-part").replace(
          "kind generic\nconstruction thick\npolarized no",
          "kind part\nmpn RC0402FR-0710KL",
        ),
      );
      mkdirSync(join(root, "assets/procurement/alternatives"), { recursive: true });
      writeFileSync(
        join(root, "assets/procurement/alternatives", "b.teda"),
        procurement("res-thick-0402 10k -> rc0402-as-part", "alternatives"),
      );
      const result = checkProject(root);
      expect(result.diagnostics.filter((d) => d.code === "library.device-unused")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a broken board does not turn its devices into false orphans", () => {
    const root = makeProject(BOARD);
    try {
      writeFileSync(join(root, "design/sch", "broken.teda"), "schematic broken\ninstances\n  ???\n");
      const result = checkProject(root);
      expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
      expect(result.diagnostics.filter((d) => d.code === "library.device-unused")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
