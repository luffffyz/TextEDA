import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listPcbs, loadPcb, loadSchematic, loadViews } from "../src/project.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples/reference-project");

describe("project loaders", () => {
  test("reads the project's logical root schematic", () => {
    const schematic = loadSchematic(projectRoot);
    expect(schematic).not.toBeNull();
    expect(schematic!.file).toBe("design/sch/main.teda");
    expect(schematic!.text.split("\n")[1]).toBe("schematic main");
  });

  test("lists and loads physical PCBs with their identity and module ownership", () => {
    expect(listPcbs(projectRoot)).toEqual(["charger-buck", "mcu-board"]);

    const charger = loadPcb(projectRoot, "charger-buck");
    expect(charger).not.toBeNull();
    expect(charger).toMatchObject({
      pcbId: "charger-buck",
      file: "design/pcb/charger-buck.teda",
    });
    expect(charger!.text.split("\n")[1]).toBe("pcb charger-buck");
    expect(charger!.text).toContain("\nmodules\n  M1\n  M2\n");

    const mcu = loadPcb(projectRoot, "mcu-board");
    expect(mcu).not.toBeNull();
    expect(mcu).toMatchObject({
      pcbId: "mcu-board",
      file: "design/pcb/mcu-board.teda",
    });
    expect(mcu!.text.split("\n")[1]).toBe("pcb mcu-board");
    expect(mcu!.text).toContain("\nmodules\n  M3\n\n");
  });

  test("loads project-level advisory print pages", () => {
    const views = loadViews(projectRoot);
    expect(views.map((view) => view.pageId)).toEqual(["main"]);
    expect(views.map((view) => view.file)).toEqual(["views/main.view.teda"]);
    for (const view of views) {
      expect(view.text.split("\n")[1]).toBe(`view ${view.pageId}`);
    }
  });
});
