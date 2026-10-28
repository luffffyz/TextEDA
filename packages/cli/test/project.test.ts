// Board loading: a board is one schematic file, and its drawing lives in a directory of print pages
// (`<page>.view.teda`, ADR-0134, ADR-0111). The directory holds drawings only.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listBoards, loadBoard } from "../src/project.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples/reference-project");

describe("loadBoard", () => {
  test("reads the board's schematic file and its print pages", () => {
    const board = loadBoard(projectRoot, "charger-buck");
    expect(board).not.toBeNull();
    expect(board!.file).toBe("design/sch/charger-buck.teda");
    expect(board!.text.split("\n")[1]).toBe("schematic charger-buck");
    expect(board!.views.map((v) => v.pageId)).toEqual(["buck-5v", "charger-power"]);
    for (const view of board!.views) {
      expect(view.text.split("\n")[1]).toBe(`view ${view.pageId}`);
    }
  });

  test("lists boards by file name only", () => {
    expect(listBoards(projectRoot)).toContain("charger-buck");
    expect(listBoards(projectRoot)).toContain("mcu-board");
  });
});
