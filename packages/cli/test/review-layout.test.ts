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
import { applyLayout, LayoutError, planLayout, renderPageSource } from "../src/layout.ts";
import { buildReviewModel } from "../src/review-model.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

/** The scratch copies this file made, so they can be taken away when it is done. */
const scratches: string[] = [];

/** A copy of the reference project, so a test can write into it. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-layout-test-"));
  cpSync(referenceProject, dir, { recursive: true });
  scratches.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

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
    expect(outcome.conflicts).toEqual([]);

    const page = content(dir, outcome.file);
    expectC1At118(page);
    // The two wires that leave C1's pins follow it; their shape is the same, their end is not.
    const parsed = parseView(page, { file: outcome.file, board: "charger-buck" });
    expect(parsed.ok).toBe(true);
    const wire = (net: string, from: string) =>
      parsed.ir?.wire?.find((candidate) => candidate.net === net && candidate.from_pin === from);
    expect(wire("GND", "M2.C1.2")?.points).toEqual([
      { x_nm: 118_000_000, y_nm: 121_000_000 },
      { x_nm: 139_000_000, y_nm: 121_000_000 },
    ]);
    expect(wire("SYS", "M2.C1.1")?.points).toEqual([
      { x_nm: 118_000_000, y_nm: 86_000_000 },
      { x_nm: 140_000_000, y_nm: 86_000_000 },
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
    const draft = text.replace("# TPS5430 5V/3A buck print page.", "# TPS5430 5V/3A buck print page (edited).");
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
    expect(written).toContain("# TPS5430 5V/3A buck print page (edited).");
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
        text: "version 0.9.1\nview buck-5v\n\nplace\n  M2.C1  118.0\n",
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
      "$1M2.C1       120.0       95.0      90",
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

  test("a field override on a page below the field version raises the page's version", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    // The page as it stood before field overrides existed: the writer must raise a page it is
    // adding a field row to, and the only way to say that is a page that has no field section.
    const original = content(dir, file)
      .replace(/^version .*$/m, "version 0.9.2")
      .replace(/\nfield\n(?:  .*\n)*/, "");
    writeFileSync(join(dir, file), original);
    expect(original.startsWith("version 0.9.2")).toBe(true);
    expect(original).not.toContain("\nfield\n");

    // No draft: the request is the file as it stands, which is 0.9.2 and has no field section. Writing
    // a field row under that version would produce a page the parser has to reject (ADR-0005), so the
    // writer raises the version it is writing.
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
    });
    expect(plan.text.startsWith("version 0.10")).toBe(true);
    const parsed = parseView(plan.text, { file, board: "charger-buck" });
    expect(parsed.ok).toBe(true);
    expect(parsed.ir?.field?.filter((field) => field.instance_id === "M2.C1")).toEqual([
      { instance_id: "M2.C1", name: "Value", x_nm: 0, y_nm: 0 },
    ]);

    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
    });
    const written = content(dir, file);
    expect(written.startsWith("version 0.10")).toBe(true);
    expect(formatView(written, { file }).text).toBe(written);
    // Everything after the new `field` section is the file's own: no place moved, no wire changed.
    expect(written.slice(written.indexOf("wire\n"))).toBe(original.slice(original.indexOf("wire\n")));
  });

  test("a page that already carries the field version keeps it, and removing the last override never lowers it", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const raised = content(dir, file).replace("version 0.9.2", "version 0.10");
    planLayout(dir, { board: "charger-buck", page: "buck-5v", places: [], text: raised, fields: [] });
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      text: raised,
      fields: [{ instance_id: "M2.C1", name: "Value", x: 0, y: 0 }],
    });
    const withField = content(dir, file);
    expect(withField.startsWith("version 0.10")).toBe(true);
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      remove_fields: [{ instance_id: "M2.C1", name: "Value" }],
    });
    const restored = content(dir, file);
    expect(
      parseView(restored, { file, board: "charger-buck" }).ir?.field?.some((field) => field.instance_id === "M2.C1"),
    ).toBe(false);
    // The version stays: it is the page's statement of what a reader must understand, and lowering it
    // would be a claim this writer cannot verify.
    expect(restored.startsWith("version 0.10")).toBe(true);
  });
  test("field-only Apply writes local overrides without repairing any wiring", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const original = content(dir, file);
    const draft = original
      .replace("version 0.9.2", "version 0.10.0")
      .replace("\nwire\n", "\n# Keep this wire-section note.\nwire\n");
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
    const original = content(dir, file).replace("version 0.9.2", "version 0.10.0");
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
      parseView(restored.text, { file, board: "charger-buck" }).ir?.field?.some((field) => field.instance_id === "M2.C1"),
    ).toBe(false);
    expect(restored.geometry.fields).toEqual(automatic);
    applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [],
      remove_fields: [{ instance_id: "M2.C1", name: "Value" }],
    });
    expect(
      parseView(content(dir, file), { file, board: "charger-buck" }).ir?.field?.some(
        (field) => field.instance_id === "M2.C1",
      ),
    ).toBe(false);
  });

  test("a mixed symbol move still reanchors its wires and saves local fields", () => {
    const dir = scratch();
    const file = "views/charger-buck/buck-5v.view.teda";
    const draft = content(dir, file).replace("version 0.9.2", "version 0.10.0");
    const outcome = applyLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
      fields: [{ instance_id: "M2.C1", name: "Reference", x: 4.25, y: -2.5 }],
      text: draft,
    });
    expect(outcome.conflicts).toEqual([]);
    const saved = parseView(content(dir, file), { file, board: "charger-buck" });
    expect(saved.ir?.field?.filter((field) => field.instance_id === "M2.C1")).toEqual([
      { instance_id: "M2.C1", name: "Reference", x_nm: 4_250_000, y_nm: -2_500_000 },
    ]);
    expect(saved.ir?.wire?.find((wire) => wire.net === "SYS" && wire.from_pin === "M2.C1.1")?.points?.[0]).toEqual({
      x_nm: 118_000_000,
      y_nm: 86_000_000,
    });
  });
});

describe("a label or a port move", () => {
  const file = "views/charger-buck/buck-5v.view.teda";
  const base = { board: "charger-buck", page: "buck-5v", places: [] };

  test("writes the row's position and leaves every other fact alone", () => {
    const dir = scratch();
    const before = content(dir, file);
    const plan = planLayout(dir, {
      ...base,
      texts: [{ id: "VOUT_5V", kind: "port", x: 208.0, y: 95.0 }],
    });
    expect(plan.changed).toBe(true);
    expect(formatView(plan.text, { file }).text).toBe(plan.text);
    const saved = parseView(plan.text, { file, board: "charger-buck" });
    expect(saved.ir?.port?.find((port) => port.id === "VOUT_5V")).toMatchObject({
      x_nm: 208_000_000,
      y_nm: 95_000_000,
    });
    // The wires are the file's own: nothing moved a pin.
    expect(saved.ir?.wire).toEqual(parseView(before, { file, board: "charger-buck" }).ir?.wire);
  });

  test("a row already at the requested position is not a change", () => {
    const dir = scratch();
    const plan = planLayout(dir, {
      ...base,
      texts: [{ id: "VOUT", kind: "label", x: 196.0, y: 91.5 }],
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
    expect(() =>
      planLayout(dir, { ...base, texts: [{ id: "GND", kind: "label", x: 1, y: 1 }] }),
    ).toThrow(/has 4 labels on this page/);
  });
});

describe("a move changes the rows it touches and nothing else", () => {
  const file = "views/charger-buck/buck-5v.view.teda";

  test("a label the person placed away from the wiring stays where it was put", () => {
    const dir = scratch();
    // Put the GND label 9 mm below the bus it names: a free placement, not a label on the wire.
    const page = join(dir, file);
    const original = readFileSync(page, "utf8");
    const moved = original.replace("  GND      130.0  121.0\n", "  GND      130.0  130.0\n");
    expect(moved).not.toBe(original);
    writeFileSync(page, moved);

    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 130.0, y: 96.5, rot: 90 }],
    });

    // The net moved, but the label was never on it, so nothing carried the label along. (The GND
    // port was on the bus, so it did follow — the reseat report names what moved.)
    expect(plan.reseated).not.toContain("label GND");
    expect(plan.text).toContain("  GND      130.0  130.0\n");
  });

  test("a label that was on the wiring follows the wiring", () => {
    const dir = scratch();
    const plan = planLayout(dir, {
      board: "charger-buck",
      page: "buck-5v",
      places: [{ instance_id: "M2.C1", x: 130.0, y: 96.5, rot: 90 }],
    });

    // The GND port sat on the bus, so the bus moving carried it along.
    expect(plan.reseated).toContain("port GND");
    expect(plan.text).toContain("  GND      130.0  121.0  180\n");
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
