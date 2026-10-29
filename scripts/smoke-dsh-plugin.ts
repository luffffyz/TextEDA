#!/usr/bin/env bun
// End-to-end smoke: the DSH plugin's host half → a bundle → a host's tools registry.
//
// The host itself is not here, so the host's own package is stood in for: the bundle is copied
// next to a stub `@deepseek-ai/dsh-tools`, and the plugin is applied to a context that records
// what it registers. What this proves is the half we own — the bundle loads, the plugin applies,
// and the tools it registers are the catalogue's.
//
// Usage: bun run scripts/smoke-dsh-plugin.ts
// Artifacts are written under /tmp/texteda-dsh-smoke/.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DshTool } from "../packages/cli/src/dsh-tools.ts";
import { toolCatalogue } from "../packages/cli/src/tools.ts";

const root = resolve(import.meta.dir, "..");
const work = "/tmp/texteda-dsh-smoke";
rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, "node_modules/@deepseek-ai/dsh-tools"), { recursive: true });

// 0) build the bundle
const build = await Bun.build({
  entrypoints: [join(root, "plugins/dsh-texteda/host.ts")],
  outdir: join(work, "plugin"),
  target: "node",
  format: "esm",
  external: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"],
  naming: "host.mjs",
});
if (!build.success) {
  for (const log of build.logs) console.error(String(log));
  console.error("the bundle did not build");
  process.exit(1);
}
console.log(`[0] bundle: ${build.outputs[0]?.path} — ${build.outputs[0]?.size} bytes`);

// 1) stand in for the host's package
writeFileSync(
  join(work, "node_modules/@deepseek-ai/dsh-tools/package.json"),
  JSON.stringify({ name: "@deepseek-ai/dsh-tools", version: "0.0.0", type: "module", main: "index.js" }),
);
writeFileSync(
  join(work, "node_modules/@deepseek-ai/dsh-tools/index.js"),
  "export const defineTool = (definition) => definition;\n",
);

// 2) apply the plugin to a context that records the registrations
// The bundle lives in a temporary directory, so it can only be reached by a runtime path.
const plugin = await import(join(work, "plugin/host.mjs"));
const registered: DshTool[] = [];
plugin.apply({ tools: { register: (definition: DshTool) => registered.push(definition) } });

const catalogue = toolCatalogue();
const names = registered.map((tool) => tool.name);
const expected = catalogue.map((tool) => tool.name);
if (JSON.stringify(names) !== JSON.stringify(expected)) {
  console.error(`the plugin registered ${names.join(", ")}; the catalogue holds ${expected.join(", ")}`);
  process.exit(1);
}
console.log(`[1] registered: ${names.join(", ")}`);

// 3) the tools take the catalogue's arguments and answer with its values
const check = registered.find((tool) => tool.name === "texteda_check");
if (check === undefined) {
  console.error("the plugin did not register texteda_check");
  process.exit(1);
}
const required = Object.entries(check.parameters)
  .filter(([, spec]) => spec.required === true)
  .map(([name]) => name);
if (JSON.stringify(required) !== JSON.stringify(catalogue[0]?.parameters.required)) {
  console.error(`the check tool requires ${required.join(", ")}; the catalogue requires ${catalogue[0]?.parameters.required?.join(", ")}`);
  process.exit(1);
}
console.log(`[2] arguments: texteda_check requires ${required.join(", ")}`);

const value = await check.execute({ project_dir: join(root, "examples/reference-project") });
if (typeof value !== "object" || value === null || !("diagnostics" in value)) {
  console.error("the check tool did not hand back the diagnostics");
  process.exit(1);
}
const diagnostics = value.diagnostics;
console.log(`[3] value: ${Array.isArray(diagnostics) ? diagnostics.length : 0} diagnostics`);

console.log("smoke ok");
