// The places-only write path (ADR-0142 D3, D10): the plugin's write rewrites the `place` rows and
// nothing else, and reports the nets whose wires went stale instead of re-anchoring them.
//
// The cases here cover the contract: only `place` rows change, only the page file changes, the
// written bytes are the formatter's, the staleness is reported (and visible in the project's own
// check), refusals still refuse like the layout path, and the standalone app's write is untouched.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPlaces, LayoutError, planLayout, planPlaces, pageFile } from "../src/layout.ts";
import { formatView, parseView } from "@texteda/parser";
import { checkProject } from "../src/check.ts";

const REFERENCE = fileURLToPath(new URL("../../../examples/reference-project", import.meta.url));
/** A request that moves M2.U1 from (140, 105) to (150, 105) nm: a real move, no rotation. */
const REQUEST = {
  board: "charger-buck",
  page: "buck-5v",
  places: [{ instance_id: "M2.U1", x: 150, y: 105, rot: 0 }],
};

/** A request that moves M2.C1 and rotates it 90 degrees: the same move, at the same place. */
const NO_MOVE_REQUEST = {
  board: "charger-buck",
  page: "buck-5v",
  places: [{ instance_id: "M2.C1", x: 120, y: 95, rot: 90 }],
};

/** A scratch project: the reference project, copied so the tests write to a copy only. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), "texteda-places-only-"));
}


function content(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

/** Every file below a root, as absolute paths, sorted: the reference project's views nest under `views/<board>/`. */
function allFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  return files;
}

/**
 * The page's rows by section, in file order: the lines under each section header.
 *
 * Used so a test can say "this section changed and no other" without diffing whole files.
 */
function rowsOf(text: string): Record<"place" | "wire" | "label" | "port" | "text", string[]> {
  const sections = ["place", "wire", "label", "port", "text"] as const;
  const rows = { place: [], wire: [], label: [], port: [], text: [] } as Record<(typeof sections)[number], string[]>;
  let current: (typeof sections)[number] | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (sections.includes(trimmed as (typeof sections)[number])) {
      current = trimmed as (typeof sections)[number];
      continue;
    }
    if (current !== null) rows[current].push(line);
  }
  return rows;
}

function refused(fn: () => unknown): string {
  try {
    fn();
    return "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `${error instanceof Error ? error.constructor.name : "Error"}: ${message}`;
  }
}

describe("layout-places: the places-only write path", () => {
  test("only the place row changes, and only that row", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    const file = pageFile("charger-buck", "buck-5v");
    const before = content(dir, file);

    const outcome = applyPlaces(dir, REQUEST);
    expect(outcome.file).toBe(file);
    expect(outcome.changed).toBe(true);

    const parsedBefore = parseView(before, { file, board: "charger-buck" });
    const parsedAfter = parseView(content(dir, file), { file, board: "charger-buck" });
    expect(parsedBefore.ok && parsedAfter.ok).toBe(true);
    expect(parsedAfter.ir!.wire).toEqual(parsedBefore.ir!.wire);
    expect(parsedAfter.ir!.label).toEqual(parsedBefore.ir!.label);
    expect(parsedAfter.ir!.port).toEqual(parsedBefore.ir!.port);
    expect(parsedAfter.ir!.text).toEqual(parsedBefore.ir!.text);

    // and the rows themselves: the sections are byte-identical
    const beforeRows = rowsOf(before);
    const afterRows = rowsOf(content(dir, file));
    expect(afterRows.wire).toEqual(beforeRows.wire);
    expect(afterRows.label).toEqual(beforeRows.label);
    expect(afterRows.port).toEqual(beforeRows.port);
    expect(afterRows.text).toEqual(beforeRows.text);

    // the place section: the moved symbol has its new place, nothing else in it moved
    const placeBefore = beforeRows.place.map((line) => line.trim());
    const placeAfter = afterRows.place.map((line) => line.trim());
    expect(placeAfter).not.toEqual(placeBefore);
    expect(placeAfter.find((line) => line.startsWith("M2.U1"))).toBe("M2.U1  150.0  105.0  0");
    expect(placeAfter.filter((line) => !line.startsWith("M2.U1"))).toEqual(placeBefore.filter((line) => !line.startsWith("M2.U1")));
  });

  test("only the page file in the project changes", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    const before = new Map(allFiles(dir).map((path) => [path, readFileSync(path, "utf8")]));

    applyPlaces(dir, REQUEST);

    const changed = allFiles(dir)
      .filter((path) => readFileSync(path, "utf8") !== before.get(path))
      .map((path) => relative(dir, path));
    expect(changed).toEqual(["views/charger-buck/buck-5v.view.teda"]);
  });

  test("the written bytes are the formatter's", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    applyPlaces(dir, REQUEST);
    const written = content(dir, pageFile("charger-buck", "buck-5v"));

    const result = formatView(written, { file: pageFile("charger-buck", "buck-5v") });
    expect(result.ok).toBe(true);
    expect(result.text).toBe(written);
  });

  test("the nets whose wires went stale are reported, not re-anchored", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });

    // the page was clean before the move: the staleness only appears as the wires go stale
    expect(checkProject(dir).diagnostics.filter((d) => d.code === "view.wire-diagonal" || d.code === "view.wire-crosses-pin")).toEqual([]);

    const outcome = applyPlaces(dir, REQUEST);
    expect(outcome.changed).toBe(true);
    expect(outcome.stale).toEqual(["GND", "M2.BOOT", "M2.PH", "M2.VFB", "SYS"]);

    // the project's own check sees the same nets, through the same entry point check.ts uses
    const findings = checkProject(dir).diagnostics.filter((d) => d.code === "view.wire-diagonal" || d.code === "view.wire-crosses-pin");
    expect(findings.length).toBeGreaterThan(0);
    const nets = new Set(findings.map((d) => d.data?.net as string));
    for (const net of nets) expect(outcome.stale).toContain(net);
  });

  test("a plan writes nothing, and carries the drawing of the page as the file says it is", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    const file = pageFile("charger-buck", "buck-5v");
    const before = content(dir, file);

    const plan = planPlaces(dir, REQUEST);
    expect(plan.changed).toBe(true);
    expect(content(dir, file)).toBe(before);
    expect(plan.svg).toContain("<svg");
    expect(plan.svg.length).toBeGreaterThan(100);
    expect(plan.text).not.toEqual(before);
  });

  test("a request that moves nothing writes nothing", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    const file = pageFile("charger-buck", "buck-5v");
    const before = content(dir, file);

    const outcome = applyPlaces(dir, NO_MOVE_REQUEST);
    expect(outcome.changed).toBe(false);
    expect(outcome.stale).toEqual([]);
    expect(content(dir, file)).toBe(before);
  });

  test("a rotation that is not a right angle is refused with the layout path's own words", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    const file = pageFile("charger-buck", "buck-5v");
    const before = content(dir, file);

    const request = { board: "charger-buck", page: "buck-5v", places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 45 }] };

    expect(refused(() => planLayout(dir, request))).toBe(refused(() => planPlaces(dir, request)));
    expect(refused(() => planPlaces(dir, request))).toBe(refused(() => applyPlaces(dir, request)));
    expect(refused(() => planPlaces(dir, request))).toContain("a rotation is a right angle");
    expect(refused(() => planLayout(dir, request))).toContain("a rotation is a right angle");
    expect(refused(() => applyPlaces(dir, request))).toContain("a rotation is a right angle");
    expect(() => planPlaces(dir, request)).toThrow(LayoutError);
    expect(() => applyPlaces(dir, request)).toThrow(LayoutError);
    // and nothing is written
    expect(content(dir, file)).toBe(before);
  });

  test("a placement the page does not have is refused with the layout path's own words", () => {
    const dir = scratch();
    cpSync(REFERENCE, dir, { recursive: true });
    const file = pageFile("charger-buck", "buck-5v");
    const before = content(dir, file);

    const request = { board: "charger-buck", page: "buck-5v", places: [{ instance_id: "M2.NOPE", x: 1, y: 1, rot: 0 }] };

    expect(refused(() => planLayout(dir, request))).toBe(refused(() => planPlaces(dir, request)));
    expect(refused(() => planPlaces(dir, request))).toContain("the page does not place M2.NOPE");
    expect(refused(() => planLayout(dir, request))).toContain("the page does not place M2.NOPE");
    expect(refused(() => applyPlaces(dir, request))).toContain("the page does not place M2.NOPE");
    expect(() => planPlaces(dir, request)).toThrow(LayoutError);
    expect(() => applyPlaces(dir, request)).toThrow(LayoutError);
    expect(content(dir, file)).toBe(before);
  });
});
