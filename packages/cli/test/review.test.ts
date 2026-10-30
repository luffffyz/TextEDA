// Contract tests for the review app's model (`texteda review`, ADR-0035).
//
// The app is only as honest as the payload it is handed: every board either has a drawing or says
// why it does not, and the document a reviewer looks at is the one CI attaches. Both are checked
// here against the reference project, whose state is known (two print pages, one board without a
// view file).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReviewHtml } from "../src/review.ts";
import { buildReviewModel } from "../src/review-model.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");

describe("review model", () => {
  const model = buildReviewModel(referenceProject);
  const board = (id: string) => model.boards.find((candidate) => candidate.id === id);

  test("every board under design/sch is listed, drawn or not", () => {
    expect(model.boards.map((candidate) => candidate.id).sort()).toEqual(["charger-buck", "mcu-board"]);
  });

  test("a page is drawn from the view file, at the sheet's own size", () => {
    const pages = board("charger-buck")?.pages ?? [];
    expect(pages.map((page) => page.id)).toEqual(["buck-5v", "charger-power"]);
    for (const page of pages) {
      expect(page.problems).toEqual([]);
      expect(page.svg).toContain("<svg");
      expect(page.sheet.w).toBeGreaterThan(0);
      // One hotspot per symbol means the app can identify what the drawing shows.
      expect(page.symbols.length).toBeGreaterThan(0);
    }
  });

  test("the drawing prints the instance's value, not the symbol's placeholder", () => {
    // The buck page places generic parts (10u / 10k) and parts (tps5430ddar). The symbol files carry
    // `c` / `r` / `dc-dc-soic8` as the Value field: those must never reach the page.
    const svg = board("charger-buck")?.pages.find((candidate) => candidate.id === "buck-5v")?.svg ?? "";
    const drawn = new Set([...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((match) => match[1]));
    // Generic parts print their value column, parts print their MPN.
    for (const value of ["10uF", "10nF", "10k", "3.24k", "TPS5430DDAR"]) expect(drawn).toContain(value);
    for (const placeholder of ["c", "r", "l", "d", "dc-dc-soic8"]) {
      expect(drawn.has(placeholder)).toBe(false);
    }
  });

  test("a board with no view file says so instead of inventing a drawing", () => {
    const mcu = board("mcu-board");
    expect(mcu?.pages).toEqual([]);
    expect(mcu?.note).toContain("no view file");
    // No view file does not mean no logic: the board's instances and nets are still there.
    expect(mcu?.instances.length).toBeGreaterThan(0);
    expect(mcu?.nets.length).toBeGreaterThan(0);
  });

  test("a selected instance carries the facts a reviewer asks for", () => {
    const instance = board("charger-buck")?.instances.find((candidate) => candidate.id === "M2.C1");
    expect(instance?.component).toBe("cap-mlcc-1210");
    expect(instance?.params).toContain("10uF");
    expect(instance?.nets).toEqual(["GND", "SYS"]);
    expect(instance?.file).toBe("design/sch/charger-buck.teda");
    expect(instance?.symbol).toBe("project:c");
    expect(instance?.footprint).toBe("project:chip-1210");
  });

  test("a selection carries the source locations behind it", () => {
    // F11 D6: the app can name the row in the board/module file, the placement on the page, and the
    // device files without re-parsing anything in the browser.
    const instance = model.sources["instance:charger-buck/M2.C1"] ?? [];
    expect(instance.map((location) => location.kind)).toEqual(["instance", "pcb-place", "view-place"]);
    expect(instance[0]).toMatchObject({ file: "design/modules/buck-5v.teda", line: 10 });
    const net = model.sources["net:charger-buck/SYS"] ?? [];
    expect(net.map((location) => location.kind)).toContain("net");
    expect(net.map((location) => location.kind)).toContain("view-label");
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
