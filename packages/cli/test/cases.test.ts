// The ten difficult cases (AGENTS.md §10, docs/backlog.md F12) are pinned by
// `bun run cases:check`; this test makes them part of `bun test` so a case cannot drift silently.
//
// Each case is a whole project under `examples/cases/<case_id>/`, compared against its committed
// expectation: the IR shards byte for byte (so the project hash is pinned too) and the diagnostics
// as code + severity + file + line (so a reworded message is not a failure, but a new warning is).
import { describe, expect, test } from "bun:test";
import { listCases, runCases } from "../../../scripts/cases.ts";

describe("the case corpus", () => {
  const ids = listCases();

  test("the landed cases are all there", () => {
    expect(ids).toContain("dual-opamp-multi-unit");
    expect(ids).toContain("nc-pins");
  });

  for (const id of ids) {
    test(`${id} matches its pinned IR and diagnostics`, () => {
      const result = runCases().find((r) => r.id === id)!;
      expect(result.problems).toEqual([]);
    });
  }
});
