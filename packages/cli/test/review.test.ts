// Contract tests for the review app's model (`texteda review`, ADR-0035).
//
// The app is only as honest as the payload it is handed: the logical root either has drawings or
// says why it does not, and the document a reviewer looks at is the one CI attaches. Both are checked
// here against the reference project, whose state is known (three print pages and two physical PCBs).
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReviewHtml } from "../src/review.ts";
import { buildReviewModel } from "../src/review-model.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

describe("review model", () => {
  const model = buildReviewModel(referenceProject);
  const board = (id: string) => model.boards.find((candidate) => candidate.id === id);

  test("the logical schematic root is listed and drawn", () => {
    expect(model.boards.map((candidate) => candidate.id).sort()).toEqual(["main"]);
  });

  test("a page is drawn from the view file, at the sheet's own size", () => {
    const pages = model.drawings.filter(
      (candidate) => candidate.kind === "sch" && candidate.board === "main",
    );
    expect(pages.map((page) => page.page)).toEqual(["buck-5v", "charger-power", "composed"]);
    for (const page of pages) {
      expect(page.problems).toEqual([]);
      expect(page.svg).toContain("<svg");
      expect(page.sheet.w).toBeGreaterThan(0);
      // One hotspot per symbol means the app can identify what the drawing shows.
      expect(page.symbols.length).toBeGreaterThan(0);
    }
  });

  test("the board's physical canvas is a drawing of its own", () => {
    const canvases = model.drawings.filter((candidate) => candidate.kind === "pcb");
    expect(canvases.map((canvas) => canvas.board)).toContain("charger-buck");
    for (const canvas of canvases) {
      expect(canvas.problems).toEqual([]);
      expect(canvas.svg).toContain("<svg");
      expect(canvas.parts?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("the library's symbols and footprints are drawings too", () => {
    const symbols = model.drawings.filter((candidate) => candidate.kind === "symbol");
    const footprints = model.drawings.filter((candidate) => candidate.kind === "footprint");
    expect(symbols.length).toBeGreaterThan(0);
    expect(footprints.length).toBeGreaterThan(0);
    for (const drawing of [...symbols, ...footprints]) {
      expect(drawing.problems).toEqual([]);
      expect(drawing.svg).toContain("<svg");
      expect(drawing.sheet.w).toBeGreaterThan(0);
      expect(drawing.sheet.h).toBeGreaterThan(0);
      // A library drawing belongs to no board: it is the library's own file.
      expect(drawing.board).toBeUndefined();
      expect(drawing.file).toMatch(/^assets\/(symbols|footprints)\//);
    }
  });

  test("the drawing prints the instance's value, not the symbol's placeholder", () => {
    // The buck page places generic parts (10u / 10k) and parts (tps5430ddar). The symbol files carry
    // `c` / `r` / `dc-dc-soic8` as the Value field: those must never reach the page.
    const svg =
      model.drawings.find((candidate) => candidate.kind === "sch" && candidate.page === "buck-5v")?.svg ?? "";
    const drawn = new Set([...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((match) => match[1]));
    // Generic parts print their value column, parts print their MPN.
    for (const value of ["10uF", "10nF", "10k", "3.24k", "TPS5430DDAR"]) expect(drawn).toContain(value);
    for (const placeholder of ["c", "r", "l", "d", "dc-dc-soic8"]) {
      expect(drawn.has(placeholder)).toBe(false);
    }
  });

  test("a project with no view file says so without losing schematic data", () => {
    const project = mkdtempSync(join(tmpdir(), "texteda-review-no-view-"));
    try {
      cpSync(referenceProject, project, { recursive: true });
      rmSync(join(project, "views"), { recursive: true, force: true });

      const noViewModel = buildReviewModel(project);
      const main = noViewModel.boards.find((candidate) => candidate.id === "main");
      expect(noViewModel.drawings.some((candidate) => candidate.kind === "sch" && candidate.board === "main")).toBe(
        false,
      );
      expect(main?.note).toContain("no view file");
      // No view file does not mean no logic: the root's instances and nets are still there.
      expect(main?.instances.length).toBeGreaterThan(0);
      expect(main?.nets.length).toBeGreaterThan(0);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("a selected instance carries the facts a reviewer asks for", () => {
    const instance = board("main")?.instances.find((candidate) => candidate.id === "M2.C1");
    expect(instance?.component).toBe("cap-mlcc-1210");
    expect(instance?.params).toContain("10uF");
    expect(instance?.nets).toEqual(["GND", "SYS"]);
    expect(instance?.file).toBe("design/sch/main.teda");
    expect(instance?.symbol).toBe("passives:c");
    expect(instance?.footprint).toBe("chip:chip-1210");
  });

  test("a selection carries the source locations behind it", () => {
    // ADR-0004 D6: the app can name the row in the board/module file, the placement on the page, and the
    // device files without re-parsing anything in the browser.
    const instance = model.sources["instance:main/M2.C1"] ?? [];
    expect(instance.map((location) => location.kind)).toEqual(["instance", "pcb-place", "view-place"]);
    expect(instance[0]).toMatchObject({ file: "design/modules/buck-5v.teda", line: 10 });
    const net = model.sources["net:main/SYS"] ?? [];
    expect(net.map((location) => location.kind)).toContain("net");
    // The page draws the net with a run: the page carries no label for it.
    expect(net.map((location) => location.kind)).toContain("view-wire");
    expect(model.sources["component:cap-mlcc-1210"]?.[0]?.file).toBe(
      "assets/components/passives/cap-mlcc-1210.teda",
    );
  });

  test("the model carries the build it describes and the project's findings", () => {
    expect(model.hash).toBeDefined();
    expect(model.diagnostics.some((diagnostic) => diagnostic.severity === "warning")).toBe(true);
    // Nothing in the reference project is an error, so the reviewer starts from a green build.
    expect(model.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });
});

describe("review document", () => {
  test("is self-contained: the model and the app travel with the HTML", async () => {
    const html = await renderReviewHtml(buildReviewModel(referenceProject));
    expect(html).toContain("window.__TEXTEDA_REVIEW__ = {");
    expect(html).toContain('type="module"');
    // An external reference would make the file depend on where it is opened from.
    expect(html).not.toContain('src="http');
    expect(html.split("</script>").length).toBe(3);
  });
});
