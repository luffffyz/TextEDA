// Compile the review app once, in memory, for the page the CLI serves.
//
// No bundler dependency and no build output on disk (ADR-0021 decision 3): `Bun.build` is part of
// the toolchain the project already requires, the entry point is one file, and the result is a
// string the server inlines. That keeps the review app a single self-contained HTML document, which
// is also what makes the static report (`texteda review --out`) an artifact CI can attach.
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("./client.ts", import.meta.url));

/**
 * The app's JavaScript, as a string.
 *
 * Deterministic in content: no source map, no minification (a reviewer may want to read what the
 * app does, and the script is small), and no ambient data — the model is injected into the page, not
 * into this script.
 */
export async function clientScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "none",
    naming: "app.js",
  });
  if (!result.success) {
    const reasons = result.logs.map((log) => log.message).join("; ");
    throw new Error(`viewer: the review app did not compile: ${reasons}`);
  }
  const output = result.outputs[0];
  if (output === undefined) throw new Error("viewer: Bun.build produced no output");
  return output.text();
}
