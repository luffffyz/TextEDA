// Apply's cost must not grow faster than the page does.
//
// Apply parses the page, computes every symbol's geometry twice, re-anchors the wires whose pins
// moved, reseats what sat on the disturbed nets, rewrites the rows that changed, and draws the
// page again. That is a fixed amount of work per row — unless something rescans the whole page
// once per row, which is what a page that grew would make obvious.
//
// The test therefore measures the *growth*, not the absolute time: a machine's speed is not the
// contract, but "four times the page must not cost sixteen times the work" is.
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planLayout } from "../src/layout.ts";
import { BENCH_REQUEST, benchPage, makeBenchProject } from "../../../scripts/benchmark-apply.ts";

const referenceProject = join(fileURLToPath(new URL("../../../", import.meta.url)), "examples", "reference-project");

/** How long a move on a page of this shape takes, in milliseconds. */
function cost(n: number, w: number, l: number): number {
  const dir = makeBenchProject(referenceProject, n, w, l);
  try {
    // makeBenchProject writes the generated page at the project-level view path consumed by planLayout.
    const start = performance.now();
    const plan = planLayout(dir, { page: BENCH_REQUEST.page, places: [...BENCH_REQUEST.places] });
    const ms = performance.now() - start;
    expect(plan.changed).toBe(true);
    return ms;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the Apply benchmark page", () => {
  test("is deterministic", () => {
    expect(benchPage(20, 20, 20)).toBe(benchPage(20, 20, 20));
  });

  test("carries the wires and the labels it claims to", () => {
    const page = benchPage(20, 30, 12);
    expect(page.split("\n").filter((line) => line.startsWith("  M2.R")).length).toBe(20);
    expect(page.split("\n").filter((line) => line.startsWith("  NET  M2.R")).length).toBe(30);
    expect(page.split("\n").filter((line) => /^  NET  \[/.test(line)).length).toBe(12);
  });
});

describe("Apply's cost grows with the page, not faster", () => {
  test("four times the rows does not cost four times the work squared", () => {
    // The smallest number of runs that a machine's noise is not the thing being measured: the
    // fastest of several runs is the one closest to the work itself.
    const fastest = (w: number, l: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) best = Math.min(best, cost(50, w, l));
      return best;
    };
    // Warm the code up: a machine's first run of anything is slower, and a benchmark that
    // compares a cold run to a warm one measures the cache, not the work.
    fastest(50, 50);

    const small = fastest(400, 400);
    const large = fastest(1600, 1600);

    // Four times the rows, four times the page. Work that is linear in the page costs about
    // three times the time here; work that rescans the page once per changed row costs about
    // five and a half. The bound sits between the two, and the absolute times are not the
    // contract — a slower machine is allowed to be slower.
    expect(large).toBeLessThan(small * 4);
  }, 60_000);
});
