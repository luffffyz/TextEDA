// CLI argument parsing and command dispatch (ADR-0038).
//
// The focus is errors like "a flag's value being treated as a positional argument": they don't crash, but they steer the command off course.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { existsSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const script = join(import.meta.dir, "../scripts/texteda.ts");

/** Run the CLI once, capturing the exit code and output. */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", script, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("argument parsing", () => {
  test("a flag with a value does not consume a positional argument", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-"));
    try {
      const out = join(root, "pcb.json");
      const result = run(["compile", "examples/reference-project", "mcu-board", "--pcb", "--out", out]);
      expect(result.stderr).not.toContain("cli.bad-usage");
      expect(result.code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a flag missing its value yields a usage error", () => {
    const result = run(["compile", "examples/reference-project", "mcu-board", "--pcb", "--out"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
  });

  test("an unknown flag errors", () => {
    const result = run(["check", "examples/reference-project", "--nope"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-flag");
  });

  test("an unknown command errors and prints usage", () => {
    const result = run(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
    expect(result.stderr).toContain("texteda check");
  });

  test("a missing command prints usage", () => {
    const result = run([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cli.bad-usage");
  });
});

describe("--out writes into a directory that does not exist yet", () => {
  test("compile creates the parent directory", () => {
    // `init` does not create `dist/` (the export commands are supposed to), so `--out dist/x.json`
    // must work on a fresh project instead of dying with a raw ENOENT.
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-out-"));
    try {
      const out = join(root, "dist", "pcb.json");
      const result = run(["compile", "examples/reference-project", "mcu-board", "--pcb", "--out", out]);
      expect(result.code).toBe(0);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("netlist creates the parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-out-"));
    try {
      const out = join(root, "dist", "netlist.txt");
      const result = run(["netlist", "examples/reference-project", "--out", out]);
      expect(result.code).toBe(0);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("check exit codes", () => {
  test("exit code 0 when there are only warnings", () => {
    const result = run(["check", "examples/reference-project"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("errors");
  });

  test("the summary counts the notes and says what was not compared", () => {
    // A report whose last line is "0 errors" reads as a pass on a design where most parts were
    // never compared (ADR-0026 D13). The summary says so.
    const result = run(["check", "examples/reference-project"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("7 notes");
    expect(result.stderr).toContain("Not fully checked: 29 of 83 instances were compared with a declared window.");
    expect(result.stderr).toContain(
      "Not fully checked: 7 of 27 resistive instances were compared with a power limit.",
    );
  });

  test("the machine payload carries the coverage of the electrical comparison", () => {
    const result = run(["check", "examples/reference-project", "--json"]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      noteCount: number;
      coverage?: {
        stress: { compared: number; total: number };
        dissipation: { compared: number; total: number };
        current: { compared: number; total: number };
      };
    };
    expect(report.noteCount).toBeGreaterThan(0);
    expect(report.coverage?.stress).toEqual({ compared: 29, total: 83 });
    expect(report.coverage?.dissipation).toEqual({ compared: 7, total: 27 });
    // Three pins carry a current requirement now: the jack (compared with its 500mA rating) and
    // the two series positions of the input stage, whose chip resistors state no rated_current.
    expect(report.coverage?.current).toEqual({ compared: 1, total: 3 });
  });

  test("a part rated below the current its pin is declared to carry is reported", () => {
    // The jack is rated 2A and the design declares its tip carries up to 2A, so the board agrees
    // and the check has nothing to say. Raising the requirement above the part's rating is what
    // makes the check speak, so the copy below is what this test looks at.
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-current-"));
    try {
      const project = join(root, "project");
      cpSync("examples/reference-project", project, {
        recursive: true,
        filter: (src) => !src.includes("/external") && !src.includes("/dist"),
      });
      const module = join(project, "design/sch/modules/charger-power.teda");
      writeFileSync(
        module,
        readFileSync(module, "utf8").replace("current  J1.1       2A", "current  J1.1       5A"),
      );
      const result = run(["check", project, "--json"]);
      const report = JSON.parse(result.stdout) as {
        diagnostics: { code: string; severity: string; message: string }[];
      };
      const finding = report.diagnostics.find((d) => d.code === "design.current-below-rating");
      expect(finding?.severity).toBe("warning");
      expect(finding?.message).toContain("pin M1.J1.1 carries at most 5A");
      expect(finding?.message).toContain("M1.J1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the reference project no longer emits schematic rail-current notes", () => {
    const result = run(["check", "examples/reference-project", "--json"]);
    const report = JSON.parse(result.stdout) as {
      diagnostics: { code: string }[];
    };
    expect(report.diagnostics.some((d) => d.code === "design.current-rail")).toBe(false);
    expect(report.diagnostics.some((d) => d.code === "design.current-exceeded")).toBe(false);
  });

  test("a window the root and the module both state is reported once, with both places", () => {
    const result = run(["check", "examples/reference-project", "--json"]);
    const report = JSON.parse(result.stdout) as {
      diagnostics: { code: string; severity: string; message: string }[];
    };
    const duplicates = report.diagnostics.filter((d) => d.code === "net.constraint-duplicate");
    expect(duplicates.length).toBe(3);
    expect(duplicates.every((d) => d.severity === "note")).toBe(true);
    expect(duplicates.some((d) => d.message.includes("net VOUT states its window (4.5V..5.5V) 2 times"))).toBe(true);
  });

  test("the reference project's pages have no text on top of each other", () => {
    // The renderer places a page's fields so that they do not cover each other; the checker is
    // what says so when a page runs out of room.
    const result = run(["check", "examples/reference-project", "--json"]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout) as {
      diagnostics: { code: string; severity: string }[];
    };
    expect(report.diagnostics.filter((d) => d.code === "view.text-overlap")).toEqual([]);
  });

  test("exit code 1 when there are errors", () => {
    const root = mkdtempSync(join(tmpdir(), "texteda-cli-bad-"));
    try {
      mkdirSync(join(root, "design/sch"), { recursive: true });
      mkdirSync(join(root, "design/sch/modules"), { recursive: true });
      writeFileSync(
        join(root, "design/sch", "main.teda"),
        "version 0.14.0\nschematic main\n\nmodules\n  M1  m\n",
      );
      writeFileSync(
        join(root, "design/sch/modules", "m.teda"),
        "version 0.8\nmodule m\n\ninstances\n  R1  no-such-part  10k\n",
      );
      const result = run(["check", root]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("ref.unknown-component");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
