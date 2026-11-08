// The layout Apply: what a placement change writes, and what it must not write (ADR-0042 D3, D5).
//
// The contract is narrow on purpose: a drawing change touches the drawing and nothing else, the
// bytes written are the formatter's, the wires that lost their pins are re-anchored, and every
// other net is left exactly as it was.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { formatView, parseView } from "@texteda/parser";
import { applyLayout as applyLayoutRaw, LayoutError, planLayout as planLayoutRaw, renderPageSource } from "../src/layout.ts";
import type { LayoutRequest } from "../src/layout.ts";
import { checkProject } from "../src/check.ts";
import { buildReviewModel } from "../src/review-model.ts";

function planLayout(root: string, request: LayoutRequest) {
  return planLayoutRaw(root, { automatic_fields: true, reanchor_wires: true, ...request });
}

function applyLayout(root: string, request: LayoutRequest) {
  return applyLayoutRaw(root, { automatic_fields: true, reanchor_wires: true, ...request });
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

/** The scratch copies this file made, so they can be taken away when it is done. */
const scratches: string[] = [];

/** A copy of the reference project, so a test can write into it. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-layout-test-"));
  // `dist/` is derived: the IR shard tree and the write backups. It is left out, so a copy does not
  // carry a backup from an earlier Apply into a test that asks what a write did or did not write.
  cpSync(referenceProject, dir, {
    recursive: true,
    filter: (source) => relative(referenceProject, source) !== "dist",
  });
  scratches.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** Every file under a directory, relative to it. `dist/` holds derived artifacts, not sources. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) {
        if (relative(dir, full) === "dist") continue;
        walk(full);
      } else out.push(relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

function content(dir: string, file: string): string {
  return readFileSync(join(dir, file), "utf8");
}

/**
 * The reference page draws a fixed set of rows. A test that needs one more writes it onto the
 * page copy, inside the section it belongs to, so the premise of the test is the test's own and
 * the page stays the one the project ships.
 */
function addRows(
  dir: string,
  rows: { wire?: string[]; label?: string[]; port?: string[] },
): void {
  const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
  const lines = readFileSync(file, "utf8").replace(/\n+$/, "\n").split("\n");
  const sections = ["place", "field", "junction", "wire", "label", "port", "text"];
  for (const [name, extra] of Object.entries(rows) as [string, string[]][]) {
    if (extra.length === 0) continue;
    const header = lines.findIndex((line) => line === name);
    if (header >= 0) {
      // The section's rows run until the next section header or a blank line.
      let end = header + 1;
      while (end < lines.length && lines[end] !== "" && !sections.includes(lines[end] ?? "")) end += 1;
      lines.splice(end, 0, ...extra.map((row) => `  ${row}`));
      continue;
    }
    // A section the page does not have goes after the last one before it, so the file's section
    // order stays the one the parser requires.
    const after = sections
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => sections.indexOf(candidate) < sections.indexOf(name))
      .map(({ candidate }) => lines.findIndex((line) => line === candidate))
      .filter((index) => index >= 0);
    const at = after.length > 0 ? Math.max(...after) + 1 : lines.length;
    // Step past the rows of the section we are inserting after.
    let insert = at;
    while (insert < lines.length && lines[insert] !== "" && !sections.includes(lines[insert] ?? "")) insert += 1;
    lines.splice(insert, 0, "", name, ...extra.map((row) => `  ${row}`));
  }
  writeFileSync(file, `${lines.join("\n")}\n`);
}

function expectC1At118(text: string): void {
  const parsed = parseView(text, {
    file: "views/charger-buck/buck-5v.view.teda",
    board: "charger-buck",
  });
  expect(parsed.ok).toBe(true);
  expect(parsed.ir?.place.find((place) => place.instance_id === "M2.C1")).toMatchObject({
    x_nm: 118_000_000,
    y_nm: 95_000_000,
    rot_mdeg: 90_000,
  });
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
    // C1 drops onto the bus at its own junction, and the move takes its pin off that junction's
    // column; the re-anchor adds a single bend.
    const page = content(dir, outcome.file);
    const parsed = parseView(page, { file: outcome.file, board: "charger-buck" });
    expect(parsed.ok).toBe(true);
    const wire = (net: string, from: string) =>
      parsed.ir?.wire?.find((candidate) => candidate.net === net && candidate.from_pin === from);
    // The leg reaches the junction sideways: the pin's column moved, the junction's did not.
    expect(wire("GND", "M2.C1.2")?.points).toEqual([{ x_nm: 118_000_000, y_nm: 121_500_000 }]);
    expect(wire("SYS", "M2.C1.1")?.points).toEqual([
      { x_nm: 118_000_000, y_nm: 89_500_000 },
      { x_nm: 140_000_000, y_nm: 89_500_000 },
    ]);
  });

  test("clears a previous rotation when a symbol is set to zero degrees", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const before = parseView(content(dir, file), { file, board: "charger-buck" });
    const c4 = before.ir?.place.find((place) => place.instance_id === "M2.C4");
    expect(c4?.rot_mdeg).toBe(90_000);
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C4", x: c4!.x_nm / 1_000_000, y: c4!.y_nm / 1_000_000, rot: 0 }],
    });
    expect(outcome.changed).toBe(true);
    const after = parseView(content(dir, file), { file, board: "charger-buck" });
    expect(after.ok).toBe(true);
    expect(after.ir?.place.find((place) => place.instance_id === "M2.C4")?.rot_mdeg).toBeUndefined();
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
    for (const index of changed) {
      expect(before[index]).toMatch(/M2\.C1  \[|GND  M2\.C1\.2|SYS  M2\.C1\.1/);
    }
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
  test("automatic field placement is opt-in while explicit field rows stay untouched", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const original = content(dir, file);
    const disabled = planLayoutRaw(dir, { board: "charger-buck", page: "buck-5v", places: [] });
    const automatic = planLayoutRaw(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      automatic_fields: true,
    });

    expect(automatic.geometry.fields).not.toEqual(disabled.geometry.fields);
    expect(disabled.text).toBe(original);
    expect(disabled.text).toContain("  M2.C3  Reference  [2.0,-3.0]");
  });

  test("disabling wire re-anchoring leaves wire rows untouched and reports stale nets", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const original = content(dir, file);
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
      reanchor_wires: false,
    });

    const before = parseView(original, { file, board: "charger-buck" }).ir?.wire;
    const after = parseView(plan.text, { file, board: "charger-buck" }).ir?.wire;
    expect(after).toEqual(before);
    expect(plan.stale).toEqual(expect.arrayContaining(["GND", "SYS"]));
  });

  test("wire re-anchoring remains enabled by default", () => {
    const dir = scratch();
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });

    expect(plan.stale).toBeUndefined();
    expect(plan.text).toContain("GND  M2.C1.2  J_GND_C1  [118.0,121.5]");
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
    expectC1At118(plan.text);
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
    const drawn = renderPageSource(dir, "charger-buck", "buck-5v", "version 0.11\npcb charger-buck\n");
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
      places: [{ instance_id: "M2.C1", x: 117.5, y: 96.5, rot: 90 }],
    });
    expect(outcome.changed).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });

  // The data-loss path (ADR-0042 D6): the editor holds text that was never saved, and a move writes the
  // page back. Without the draft in the request, the write is the file on disk and the edit is
  // gone.
  test("a move keeps the editor's unsaved text", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const text = readFileSync(file, "utf8");
    // The editor's text: the same page with one comment changed.
    const draft = text.replace("Every net of this module is drawn here", "Every net of this module is drawn here (edited)");
    expect(draft).not.toBe(text);

    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
      text: draft,
    });
    expect(outcome.changed).toBe(true);

    const written = readFileSync(file, "utf8");
    // The edit is still there, and so is the move.
    expect(written).toContain("Every net of this module is drawn here (edited)");
    expectC1At118(written);
  });

  test("a move without a draft writes the file on disk, as before", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const before = readFileSync(file, "utf8");
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    expect(outcome.changed).toBe(true);
    const written = readFileSync(file, "utf8");
    expect(written).not.toBe(before);
    expectC1At118(written);
  });

  test("a draft that does not parse is refused, and nothing is written", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const before = readFileSync(file, "utf8");
    expect(() =>
      applyLayout(dir, {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        text: "version 0.11\nview buck-5v\n\nplace\n  M2.C1  118.0\n",
      }),
    ).toThrow(LayoutError);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("the file a draft write produces is the formatter's form", () => {
    const dir = scratch();
    const file = join(dir, "views", "charger-buck", "buck-5v.view.teda");
    const text = readFileSync(file, "utf8");
    // A draft with a column the formatter would realign.
    const draft = text.replace(
      /^([ \t]*)M2\.C1\b.*$/m,
      "$1M2.C1       [120.0,95.0]      90",
    );
    expect(draft).not.toBe(text);
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
      text: draft,
    });
    expect(outcome.changed).toBe(true);
    const written = readFileSync(file, "utf8");
    expectC1At118(written);
    // The columns are aligned the way the formatter aligns them, not the way the draft had them.
    const canonical = formatView(written, { file: "views/charger-buck/buck-5v.view.teda" });
    expect(canonical.ok).toBe(true);
    expect(canonical.text).toBe(written);
  });

  test("a field override on a page below the reader floor is rejected before any write", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    // Layout validates the page before planning edits. An old page must go through the explicit
    // migration command; it is not silently raised by a field edit.
    const original = content(dir, file)
      .replace(/^version .*$/m, "version 0.9.2")
      .replace(/\nfield\n(?:  .*\n)*/, "");
    writeFileSync(join(dir, file), original);
    expect(original.startsWith("version 0.9.2")).toBe(true);
    expect(original).not.toContain("\nfield\n");

    expect(() =>
      planLayout(dir, {
        board: "charger-buck",
        page: "buck-5v",
        places: [],
        fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
      }),
    ).toThrow(/minimum is 0\.11/);
    expect(content(dir, file)).toBe(original);
  });

  test("a page that already carries the field version keeps it, and removing the last override never lowers it", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const raised = content(dir, file).replace(/^version .*$/m, "version 0.11");
    planLayout(dir, { board: "charger-buck", page: "buck-5v", places: [], text: raised, fields: [] });
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      text: raised,
      fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
    });
    const withField = content(dir, file);
    expect(withField.startsWith("version 0.11")).toBe(true);
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      remove_fields: [{ instance_id: "M2.C1", name: "Value" }],
    });
    const restored = content(dir, file);
    const restoredRows = parseView(restored, { file, board: "charger-buck" }).ir?.field ?? [];
    expect(restoredRows.filter((field) => field.instance_id === "M2.C1")).toEqual([]);

    // The version stays: it is the page's statement of what a reader must understand, and lowering it
    // would be a claim this writer cannot verify.
    expect(restored.startsWith("version 0.11")).toBe(true);
  });

  test("field-only Apply writes local overrides without repairing any wiring", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const original = content(dir, file);
    const draft = original.replace("\nwire\n", "\n# Keep this wire-section note.\nwire\n");
    const request = {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      text: draft,
      fields: [
        { instance_id: "M2.C1", name: "Value" as const, x: 0, y: 0 },
        { instance_id: "M2.C1", name: "Reference" as const, x: -0.01, y: 0.01 },
      ],
    };
    const plan = planLayout(dir, request);
    expect(plan.changed).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.reseated).toEqual([]);
    expect(plan.text).toContain("# Keep this wire-section note.");
    expect(plan.text.indexOf("field\n")).toBeLessThan(plan.text.indexOf("# Keep this wire-section note."));
    const beforeWires = parseView(draft, { file, board: "charger-buck" }).ir?.wire;
    const after = parseView(plan.text, { file, board: "charger-buck" });
    expect(after.ok).toBe(true);
    expect(after.ir?.wire).toEqual(beforeWires);
    expect(after.ir?.field?.filter((field) => field.instance_id === "M2.C1")).toEqual([
      { instance_id: "M2.C1", name: "Reference", x_nm: -10_000, y_nm: 10_000 },
      { instance_id: "M2.C1", name: "Value", x_nm: 0, y_nm: 0 },
    ]);
    expect(content(dir, file)).toBe(original);

    applyLayout(dir, request);
    const persisted = parseView(content(dir, file), { file, board: "charger-buck" });
    expect(persisted.ir?.field).toEqual(after.ir?.field);
  });

  test("removing an override restores renderer-owned automatic field placement", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const original = content(dir, file);
    const base = { board: "charger-buck", page: "buck-5v", places: [], text: original };
    const automatic = planLayout(dir, base).geometry.fields;
    applyLayout(dir, {
      ...base,
      fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
    });
    const overridden = parseView(content(dir, file), { file, board: "charger-buck" });
    expect(overridden.ir?.field?.filter((field) => field.instance_id === "M2.C1")).toEqual([
      { instance_id: "M2.C1", name: "Value", x_nm: 0, y_nm: 0 },
    ]);
    const restored = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      remove_fields: [{ instance_id: "M2.C1", name: "Value" }],
    });
    expect(restored.changed).toBe(true);
    expect(
      (parseView(restored.text, { file, board: "charger-buck" }).ir?.field ?? []).filter(
        (field) => field.instance_id === "M2.C1",
      ),
    ).toEqual([]);
    expect(restored.geometry.fields).toEqual(automatic);
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      remove_fields: [{ instance_id: "M2.C1", name: "Value" }],
    });
    expect(
      (
        parseView(content(dir, file), { file, board: "charger-buck" }).ir?.field ?? []
      ).filter((field) => field.instance_id === "M2.C1"),
    ).toEqual([]);
  });

  test("a mixed symbol move still reanchors its wires and saves local fields", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const draft = content(dir, file).replace("version 0.11", "version 0.11.1");
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
      fields: [{ instance_id: "M2.C1", name: "Reference", x: 4.25, y: -2.5 }],
      text: draft,
    });
    // The move still re-anchors the wires: C1's bus leg lost its corner and is reported, and neither
    // the draft nor the field row is lost with it.
    expect(outcome.conflicts).toEqual(["GND M2.C1.2 → J_GND_C1: the wire's shape could not be kept (shape-lost)"]);
    const saved = parseView(content(dir, file), { file, board: "charger-buck" });
    expect(saved.ir?.field?.filter((field) => field.instance_id === "M2.C1")).toEqual([
      { instance_id: "M2.C1", name: "Reference", x_nm: 4_250_000, y_nm: -2_500_000 },
    ]);
    expect(saved.ir?.wire?.find((wire) => wire.net === "SYS" && wire.from_pin === "M2.C1.1")?.points?.[0]).toEqual({
      x_nm: 118_000_000,
      y_nm: 89_500_000,
    });
  });

  test("every automatic field sits against its own body, and Apply keeps it there", () => {
    // The complaint this guards: field rows hand-placed to dodge a collision survive a later
    // respacing of the page, so the value floats far from the part it names. An automatic field
    // is renderer-owned, so moving the part must carry the text with it, and no field may sit
    // further from its body than the renderer's own clearance rule allows.
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const page = { board: "charger-buck", page: "buck-5v", places: [] };

    const fieldGaps = (): { key: string; gap_nm: number }[] => {
      const geometry = planLayout(dir, page).geometry;
      const bodies = new Map(geometry.symbols.map((symbol) => [symbol.instance_id, symbol.box]));
      const gaps: { key: string; gap_nm: number }[] = [];
      for (const field of geometry.fields) {
        const body = bodies.get(field.instance_id);
        if (body === undefined) continue;
        const dx = Math.max(body.min_x_nm - field.box.max_x_nm, field.box.min_x_nm - body.max_x_nm, 0);
        const dy = Math.max(body.min_y_nm - field.box.max_y_nm, field.box.min_y_nm - body.max_y_nm, 0);
        gaps.push({ key: `${field.instance_id}:${field.name}`, gap_nm: Math.hypot(dx, dy) });
      }
      return gaps;
    };

    const moved = { instance_id: "M2.C1", x: 121.5, y: 95, rot: 90 };
    const plan = planLayout(dir, { ...page, places: [moved] });
    // Apply writes no override row for a symbol it moved: the renderer owns the position, so a
    // later move cannot leave a stale anchor behind on the page.
    const rows = parseView(plan.text, { file, board: "charger-buck" }).ir?.field ?? [];
    expect(rows.filter((row) => row.instance_id === "M2.C1")).toEqual([]);

    applyLayout(dir, { ...page, places: [moved] });
    const gaps = fieldGaps();
    expect(gaps.length).toBeGreaterThan(0);
    // Automatic fields hug their body: the renderer places a field on the slot it wants or on the
    // next free slot around the body — 1 mm, 3 mm or 5 mm out. A stale override would leave the
    // text many millimetres away, which is what this catches.
    expect(gaps.filter((field) => field.gap_nm > 5_500_000)).toEqual([]);
  });
});

describe("a label or a port move", () => {
  const file = "views/charger-buck/buck-5v.view.teda";
  const base = { board: "charger-buck", page: "buck-5v", places: [] };

  test("moving a port along its wire preserves the existing wire references", () => {
    const dir = scratch();
    const fileText = content(dir, file);
    const plan = planLayout(dir, {
      ...base,
      texts: [{ id: "VOUT_5V", kind: "port", x: 230.0, y: 101.5 }],
    });
    expect(plan.changed).toBe(true);
    expect(formatView(plan.text, { file }).text).toBe(plan.text);
    const saved = parseView(plan.text, { file, board: "charger-buck" });
    expect(saved.ir?.port?.find((port) => port.id === "VOUT_5V")).toMatchObject({
      x_nm: 230_000_000,
      y_nm: 101_500_000,
    });
    const beforeWires = parseView(fileText, { file, board: "charger-buck" }).ir?.wire ?? [];
    expect(saved.ir?.wire).toEqual(beforeWires);
    expect(plan.conflicts).toEqual([]);
  });

  test("a row already at the requested position is not a change", () => {
    const dir = scratch();
    // The page's own VOUT label sits at x = 205.0 mm: moving it where it already is is no change.
    const plan = planLayout(dir, {
      ...base,
      texts: [{ id: "VOUT", kind: "label", x: 205.0, y: 101.5 }],
    });
    expect(plan.changed).toBe(false);
    expect(content(dir, file)).toBe(content(dir, file));
  });

  test("the write rejects coordinates finer than the format's resolution", () => {
    const dir = scratch();
    expect(() =>
      planLayout(dir, { ...base, texts: [{ id: "VOUT", kind: "label", x: 196.005, y: 91.5 }] }),
    ).toThrow(/limited to 0\.01 mm resolution/);
  });

  test("the write refuses a net the page does not label and a port it does not draw", () => {
    const dir = scratch();
    expect(() => planLayout(dir, { ...base, texts: [{ id: "NOPE", kind: "label", x: 1, y: 1 }] })).toThrow(
      /no label for net NOPE/,
    );
    expect(() => planLayout(dir, { ...base, texts: [{ id: "NOPE", kind: "port", x: 1, y: 1 }] })).toThrow(
      /does not draw port NOPE/,
    );
  });

  test("two labels of one net are refused, because the net does not name one row", () => {
    const dir = scratch();
    // Three GND labels on the bus beside the one the page ships: the net names no one row, so a
    // label cannot be moved by its net.
    addRows(dir, { label: ["GND  [130.0,121.5]", "GND  [190.0,121.5]", "GND  [211.0,121.5]"] });
    expect(() =>
      planLayout(dir, { ...base, texts: [{ id: "GND", kind: "label", x: 1, y: 1 }] }),
    ).toThrow(/has 4 labels on this page/);
  });
});

describe("a move changes the rows it touches and nothing else", () => {
  const file = "views/charger-buck/buck-5v.view.teda";

  test("a label the person placed away from the wiring stays where it was put", () => {
    const dir = scratch();
    // Put the page's GND label 10 mm below the bus it names: a free placement, not a label on the
    // wire.
    const page = join(dir, file);
    const original = readFileSync(page, "utf8");
    // The rows are aligned by the formatter, so the row is matched by its cells, not by its spacing.
    const moved = original.replace(/^ {2}GND\s+\[160\.0,121\.5\]$/m, "  GND  [160.0,131.5]");
    expect(moved).not.toBe(original);
    writeFileSync(page, moved);

    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 130.0, y: 96.5, rot: 90 }],
    });

    // The net moved, but the label was never on it, so nothing carried the label along.
    expect(plan.reseated).not.toContain("label GND");
    expect(plan.text).toMatch(/^ {2}GND\s+\[160\.0,131\.5\]$/m);
  });

  test("a label that was on a pin follows the pin", () => {
    const dir = scratch();
    // Besides the page's own VFB label, put one on the chip's VSENSE pin: the page ships with
    // neither of the two moves this test makes.
    addRows(dir, { label: ["M2.VFB  [125.0,106.0]"] });
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.U1", x: 135.0, y: 105.0, rot: 0 }],
    });

    // The VFB label sat on the chip's VSENSE pin, which is part of the net's drawing
    // (spec/schematic-view.md §6). The chip moved, so the label travelled with the pin. The page's
    // own VFB label sits on the wire the chip did not move, and stayed where it was.
    expect(plan.reseated).toContain("label M2.VFB");
    expect(plan.text).toMatch(/^ {2}M2\.VFB\s+\[120\.0,106\.0\]$/m);
    expect(plan.text).toMatch(/^ {2}M2\.VFB\s+\[150\.0,115\.0\]$/m);
  });

  test("the rows the move did not touch are byte-identical", () => {
    const dir = scratch();
    const before = readFileSync(join(dir, file), "utf8").split("\n");
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 130.0, y: 96.5, rot: 90 }],
    });
    const after = plan.text.split("\n");

    // The moved symbol's own row and the rows of what hangs on it change; the rest does not.
    const changed: number[] = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (before[i] !== after[i]) changed.push(i + 1);
    }
    expect(changed.length).toBeLessThan(before.length / 4);
    expect(plan.text.split("\n").filter((line) => line.startsWith("  M2.D1"))).toEqual(
      before.filter((line) => line.startsWith("  M2.D1")),
    );
    expect(plan.text.split("\n").filter((line) => line.startsWith("  M2.VFB"))).toEqual(
      before.filter((line) => line.startsWith("  M2.VFB")),
    );
  });
});

/** The runs a net is drawn with, as `x,y` point lists in millimetres: the shape the reader sees. */
function runs(svg: string, net: string): string[] {
  const group = new RegExp(`<g data-ref="net:${net}"[^>]*>([\\s\\S]*?)</g>`).exec(svg);
  if (!group) return [];
  return [...group[1]!.matchAll(/<polyline points="([^"]+)"/g)].map((match) => match[1]!);
}

/** The declared junction dots in a page's drawing, as `x,y` in millimetres. */
function declaredJunctionDots(svg: string): Set<string> {
  const dots = new Set<string>();
  for (const match of svg.matchAll(/<g data-ref="junction:[^"]*">\s*<circle cx="([^"]+)" cy="([^"]+)" r="0.4572"/g)) {
    dots.add(`${match[1]},${match[2]}`);
  }
  return dots;
}

describe("the layout Apply keeps the drawing honest", () => {
  test("moving a pin past its corner adds no explicit junction dot", () => {
    // A declared junction is a graph node the page writes down. The renderer may add a visual
    // pin-junction marker for a perpendicular pin endpoint, but that marker does not move or add a
    // declared junction, and it does not make the pin a graph connection.
    const dir = scratch();
    const before = planLayout(dir, { board: "charger-buck", page: "buck-5v", places: [] });
    const after = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.R2", x: 200.5, y: 109.5, rot: 90 }],
    });
    expect([...declaredJunctionDots(after.svg)]).toHaveLength([...declaredJunctionDots(before.svg)].length);
    const added = [...declaredJunctionDots(after.svg)].filter((dot) => !declaredJunctionDots(before.svg).has(dot));
    expect(added).toEqual([]);
    // The declared junctions did not move with the pin either.
    expect([...declaredJunctionDots(after.svg)]).toEqual([...declaredJunctionDots(before.svg)]);
  });

  test("moving a port off a bus reports the lost shape and keeps the junction stationary", () => {
    const dir = scratch();
    // GND already ends at the authored port and the stationary J_GND_C1 junction. Moving the port
    // off the bus cannot preserve a straight run, so the command reports the conflict and emits
    // the one elbow implied by the original direction.
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      texts: [{ kind: "port", id: "GND", x: 120, y: 115 }],
    });
    expect(plan.changed).toBe(true);
    const run = plan.text.split("\n").find((line) => line.startsWith("  GND  GND  J_GND_C1"));
    expect(run).toContain("[117.5,115.0]");
    expect(plan.conflicts).toEqual([
      "GND GND → J_GND_C1: the wire's shape could not be kept (shape-lost)",
    ]);
    const parsed = parseView(plan.text, { file: "views/charger-buck/buck-5v.view.teda", board: "charger-buck" });
    expect(parsed.ir).toBeDefined();
  });

  test("moving R2 preserves the authored VFB route and reports the displaced straight run", () => {
    const dir = scratch();
    const before = planLayout(dir, { board: "charger-buck", page: "buck-5v", places: [] });
    const after = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.R2", x: 195.5, y: 115.5, rot: 90 }],
    });
    const runOf = (text: string) =>
      text.split("\n").find((line) => line.includes("M2.U1.4") && line.trim().startsWith("M2.VFB"));
    expect(runOf(before.text)).toContain("[190.0,111.5]");
    expect(runOf(after.text)).toContain("[120.0,106.0]");
    expect(runOf(after.text)).toContain("[190.0,111.5]");
    expect(after.conflicts).toEqual([
      "GND M2.R2.2 → J_GND_R2: the wire's shape could not be kept (shape-lost)",
      "M2.VFB M2.R1.2 → M2.R2.1: the wire's shape could not be kept (shape-lost)",
    ]);
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.R2", x: 195.5, y: 115.5, rot: 90 }],
    });
    const warnings = checkProject(dir).diagnostics.filter(
      (diagnostic) => diagnostic.code === "view.wire-diagonal",
    );
    expect(warnings).toEqual([]);
  });

  test("moving R2 onto the GND bus preserves the authored junction identity", () => {
    const dir = scratch();
    const before = parseView(content(dir, "views/charger-buck/buck-5v.view.teda"), {
      file: "views/charger-buck/buck-5v.view.teda",
      board: "charger-buck",
    });
    const after = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.R2", x: 197, y: 117.5, rot: 90 }],
    });
    const parsed = parseView(after.text, {
      file: "views/charger-buck/buck-5v.view.teda",
      board: "charger-buck",
    });
    expect(parsed.ir?.junction).toEqual(before.ir?.junction);
    expect(parsed.ir?.wire?.find((wire) => wire.from_pin === "M2.R2.2")).toMatchObject({
      to_pin: "J_GND_R2",
    });
    expect(after.text).toContain("J_GND_R2   [197.0,121.5]");
    expect(after.conflicts).toEqual([]);
  });

  test("moving C4 leaves authored junctions and wire endpoint identities stationary", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const before = parseView(content(dir, file), { file, board: "charger-buck" });
    const after = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C4", x: 228.5, y: 106.5, rot: 90 }],
    });
    const parsed = parseView(after.text, { file, board: "charger-buck" });
    expect(parsed.ir?.junction).toEqual(before.ir?.junction);
    expect(parsed.ir?.wire?.find((wire) => wire.from_pin === "M2.C4.2")).toMatchObject({
      to_pin: "J_GND_C3",
    });
    expect(after.conflicts.every((conflict) => conflict.includes("shape-lost"))).toBe(true);
  });

  test("a bus keeps its line: moving a branch pin does not move the declared junction", () => {
    const dir = scratch();
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
    });
    const run = plan.text.split("\n").find((line) => line.startsWith("  GND  M2.C1.2"));
    expect(run).toContain("[118.0,121.5]");
    expect(run).toContain("J_GND_C1");
    expect(plan.text).toContain("J_GND_C1   [117.5,121.5]");
    expect(run).not.toContain("100.5");
  });

  test("a port this page does not draw cannot end a run", () => {
    // The run's end point comes from the port row; with no row there is nowhere to end, and the
    // parser says so instead of drawing a run to an invented point.
    const parsed = parseView(
      "version 0.11\nview buck-5v\nsheet [297,210]\nplace\n  U1  [10.0,10.0]\nwire\n  GND  U1.1  NOPE\n",
      { file: "views/charger-buck/buck-5v.view.teda", board: "charger-buck" },
    );
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("view.port-not-drawn");
  });
});
