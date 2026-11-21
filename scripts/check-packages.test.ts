import { describe, expect, test } from "bun:test";

import { findBoundaryViolations, type PackageSourceFile } from "./check-packages";

function source(path: string, text: string): PackageSourceFile {
  return { path, text };
}

describe("package boundary gate", () => {
  test("rejects Bun, environment and filesystem access in library source", () => {
    const violations = findBoundaryViolations([
      source(
        "packages/core/src/bad.ts",
        'import { readFileSync } from "node:fs";\nconst value = process.env.VALUE;\nBun.spawn(["tool"]);',
      ),
    ]);

    expect(violations).toEqual([
      {
        path: "packages/core/src/bad.ts",
        line: 1,
        rule: "node:fs",
        text: 'import { readFileSync } from "node:fs";',
      },
      {
        path: "packages/core/src/bad.ts",
        line: 2,
        rule: "process.env",
        text: "const value = process.env.VALUE;",
      },
      {
        path: "packages/core/src/bad.ts",
        line: 3,
        rule: "Bun.spawn",
        text: 'Bun.spawn(["tool"]);',
      },
    ]);
  });

  test("allows only the named viewer build exception", () => {
    expect(
      findBoundaryViolations([
        source("packages/viewer/src/build.ts", "await Bun.build({ entrypoints: [] });"),
      ]),
    ).toEqual([]);

    expect(
      findBoundaryViolations([source("packages/viewer/src/build.ts", "Bun.spawn([\"tool\"]);")]),
    ).toEqual([
      {
        path: "packages/viewer/src/build.ts",
        line: 1,
        rule: "Bun.spawn",
        text: 'Bun.spawn(["tool"]);',
      },
    ]);
  });
});
