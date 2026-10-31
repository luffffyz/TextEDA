import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderApiReference } from "./api-reference.ts";

test("API reference resolves package exports, aliases, signatures, and declaration links", () => {
  const root = mkdtempSync(join(tmpdir(), "texteda-api-reference-"));
  try {
    mkdirSync(join(root, "packages", "fixture", "src"), { recursive: true });
    writeFileSync(
      join(root, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
        },
      }),
    );
    writeFileSync(
      join(root, "packages", "fixture", "package.json"),
      JSON.stringify({
        name: "@fixture/api",
        exports: {
          ".": "./src/index.ts",
          "./types": "./src/types.ts",
        },
      }),
    );
    writeFileSync(
      join(root, "packages", "fixture", "src", "index.ts"),
      'export { internal as publicOpen } from "./implementation";\nexport * from "./types";\n',
    );
    writeFileSync(
      join(root, "packages", "fixture", "src", "implementation.ts"),
      "/** Adds two numbers. Rules come from teda.md §2. */\nexport function internal(left: number, right: number): number {\n  return left + right;\n}\n",
    );
    writeFileSync(
      join(root, "packages", "fixture", "src", "types.ts"),
      "export interface Options { enabled: boolean; }\n",
    );

    const documents = new Map(renderApiReference(root).map(({ path, content }) => [path, content]));
    const index = documents.get("README.md");
    const packagePage = documents.get("packages/fixture.md");

    expect(index).toBeDefined();
    expect(packagePage).toBeDefined();
    expect(index).toContain("@fixture/api");
    expect(index).toContain("packages/fixture.md");
    expect(packagePage).toContain("publicOpen</code> | function");
    expect(packagePage).toContain("left: number");
    expect(packagePage).toContain("Adds two numbers.");
    expect(packagePage).toContain("spec/teda.md §2.");
    expect(packagePage).toMatch(/Options<\/code> \| interface \| <code>Options<\/code>/);
    expect(packagePage).toMatch(/implementation\.ts#L\d+/);
    expect(packagePage).toMatch(/\]\(\.\.\/\.\.\/\.\.\/packages\/fixture\/src\/implementation\.ts#L\d+\)/);
    expect(packagePage).toContain("@fixture/api/types");
    expect(packagePage).toContain("Options</code> | interface");
    expect(packagePage).toMatch(/\.\.\/\.\.\/\.\.\/packages\/fixture\/src\/types\.ts#L\d+/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
