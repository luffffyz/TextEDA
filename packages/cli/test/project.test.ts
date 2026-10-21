// Board loading: a page directory contains both page descriptions (`<page>.teda`) and their
// drawings (`<page>.view.teda`, ADR-0021). Only the former are pages.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listBoards, loadBoard } from "../src/project.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectRoot = join(repoRoot, "examples/reference-project");

describe("loadBoard", () => {
  test("lists page descriptions and skips their view files", () => {
    const board = loadBoard(projectRoot, "charger-buck");
    expect(board).not.toBeNull();
    expect(board!.pages.map((p) => p.pageId)).toEqual(["buck-5v", "charger-power"]);
    for (const page of board!.pages) {
      expect(page.text.split("\n")[1]).toBe(`page ${page.pageId}`);
    }
  });

  test("lists boards by file name only", () => {
    expect(listBoards(projectRoot)).toContain("charger-buck");
    expect(listBoards(projectRoot)).toContain("mcu-board");
  });
});
