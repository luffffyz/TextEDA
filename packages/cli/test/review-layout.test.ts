// The layout Apply: what a placement change writes, and what it must not write (ADR-0141 D3, D5).
//
// The contract is narrow on purpose: a drawing change touches the drawing and nothing else, the
// bytes written are the formatter's, the wires that lost their pins are re-anchored, and every
// other net is left exactly as it was.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseView } from "@texteda/parser";
import { applyLayout, LayoutError, planLayout, renderPageSource } from "../src/layout.ts";
import { buildReviewModel } from "../src/review-model.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

/** A copy of the reference project, so a test can write into it. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-layout-test-"));
  cpSync(referenceProject, dir, { recursive: true });
  return dir;
}

/** Every file under a directory, relative to it. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

function content(dir: string, file: string): string {
  return readFileSync(join(dir, file), "utf8");
}

describe("the layout Apply", () => {
  test("moves a symbol and rewrites the wires that lost their pins", () => {
    const dir = scratch();
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.file).toBe("views/charger-buck/buck-5v.view.teda");
    expect(outcome.conflicts).toEqual([]);

    const page = content(dir, outcome.file);
    expect(page).toContain("M2.C1  118.0  95.0  90");
    // The two wires that leave C1's pins follow it; their shape is the same, their end is not.
    const parsed = parseView(page, { file: outcome.file, board: "charger-buck" });
    expect(parsed.ok).toBe(true);
    const wire = (net: string, from: string) =>
      parsed.ir?.wire?.find((candidate) => candidate.net === net && candidate.from_pin === from);
    expect(wire("GND", "M2.C1.2")?.points).toEqual([
      { x_nm: 118_000_000, y_nm: 120_000_000 },
      { x_nm: 137_460_000, y_nm: 120_000_000 },
    ]);
    expect(wire("SYS", "M2.C1.1")?.points).toEqual([
      { x_nm: 118_000_000, y_nm: 83_000_000 },
      { x_nm: 140_000_000, y_nm: 83_000_000 },
    ]);
  });

  test("leaves the rows it did not touch exactly as they were", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const before = content(dir, file).split("\n");
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    const after = content(dir, file).split("\n");
    const changed = before
      .map((line, index) => (line === after[index] ? undefined : index))
      .filter((index): index is number => index !== undefined);
    // The symbol and the two wires that leave its pins. Nothing else moves, not even in spelling.
    expect(changed.length).toBe(3);
    for (const index of changed) expect(before[index]).toMatch(/M2\.C1|GND      M2\.C1\.2|SYS      M2\.C1\.1/);
  });

  test("writes the drawing and nothing else", () => {
    const dir = scratch();
    const before = tree(dir).map((file) => [file, content(dir, file)] as const);
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    const changed = before
      .filter(([file, text]) => content(dir, file) !== text)
      .map(([file]) => file);
    // Only the print page changed: the circuit, the assets and the project file are untouched.
    expect(changed).toEqual(["views/charger-buck/buck-5v.view.teda"]);
  });

  test("the file it writes is the formatter's form", () => {
    const dir = scratch();
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    // `fmt --check` on the written file: the bytes are canonical, so the diff shows the change.
    const check = Bun.spawnSync(
      ["bun", "run", join(repoRoot, "packages", "parser", "scripts", "fmt-teda.ts"), "--check", file],
      {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(check.stderr.toString()).toBe("");
    expect(check.exitCode).toBe(0);
  });

  test("leaves the other pages and the other nets alone", () => {
    const dir = scratch();
    const other = content(dir, "views/charger-buck/charger-power.view.teda");
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    expect(content(dir, "views/charger-buck/charger-power.view.teda")).toBe(other);
  });

  test("refuses a placement the page does not have", () => {
    const dir = scratch();
    expect(() =>
      applyLayout(dir, {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.NOPE", x: 10, y: 10, rot: 0 }],
      }),
    ).toThrow(LayoutError);
  });

  test("refuses a rotation that is not a right angle", () => {
    const dir = scratch();
    expect(() =>
      applyLayout(dir, {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 45 }],
      }),
    ).toThrow(LayoutError);
  });

  test("the change leaves the page with no new findings", () => {
    const dir = scratch();
    const before = buildReviewModel(dir).diagnostics.filter((d) => d.code.startsWith("view."));
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    const after = buildReviewModel(dir).diagnostics.filter((d) => d.code.startsWith("view."));
    const codes = (list: typeof before) => list.map((d) => d.code).sort();
    expect(codes(after)).toEqual(codes(before));
  });

  test("a plan carries the page as it would be, and writes nothing", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const before = readFileSync(file, "utf8");
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    expect(plan.changed).toBe(true);
    expect(plan.file).toBe("views/charger-buck/buck-5v.view.teda");
    // The plan is the page after the change: its source and its drawing.
    expect(plan.text).toContain("M2.C1  118.0  95.0  90");
    expect(plan.svg).toContain("<svg");
    // The file on disk is the one that was there.
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("a draft is drawn with the row of every object, and nothing is written", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const text = readFileSync(file, "utf8");
    const drawn = renderPageSource(dir, "charger-buck", "buck-5v", text);
    expect(drawn.errors).toEqual([]);
    expect(drawn.svg).toContain("<svg");
    const rows = drawn.anchors;
    const place = rows.find((row) => row.key === "M2.C1");
    expect(place?.kind).toBe("place");
    expect(text.split("\n")[place!.line - 1]).toContain("M2.C1");
    // A wire names its net, and its row is the wire row.
    const wire = rows.find((row) => row.kind === "wire");
    expect(wire).toBeDefined();
    expect(text.split("\n")[wire!.line - 1]).toContain(wire!.key);
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  test("a draft that does not parse is reported, and nothing is written", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const text = readFileSync(file, "utf8");
    const drawn = renderPageSource(dir, "charger-buck", "buck-5v", "version 0.9.1\npcb charger-buck\n");
    expect(drawn.errors.length).toBeGreaterThan(0);
    expect(drawn.svg).toBe("");
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  test("a move that changes nothing writes nothing", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const before = statSync(file).mtimeMs;
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 120, y: 95, rot: 90 }],
    });
    expect(outcome.changed).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });
});
