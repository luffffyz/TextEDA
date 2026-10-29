// Bundle both halves of the DSH plugin.
//
// DSH loads a plugin's host half as one file and its client half as one browser module. Our
// packages are not published (F53), so both bundles carry them; the host's own packages stay
// external, because the host provides them — and for the client half that includes React, which the
// host serves as a platform module (DSH's `PLATFORM_MODULES`) and this repository must not depend on.
//
// The client half is wrapped in DSH's module-loader frame: the host evaluates the file, hands it a
// `require` resolved against the platform modules, and takes `module.exports` — which must be the
// `{ inject, apply }` pair. The wrapper shape is the host's own (its `tsdown.client.ts`).
//
// The output is not tracked: it is built, not written by hand.
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const plugin = resolve(root, "plugins/dsh-texteda");
const externals = ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"];

async function build(options: Parameters<typeof Bun.build>[0]): Promise<void> {
  const result = await Bun.build(options);
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
  for (const artifact of result.outputs) {
    console.log(`${artifact.path} — ${artifact.size} bytes`);
  }
}

// The host half: Node, ESM, `plugins/dsh-texteda/dist/host.mjs`.
await build({
  entrypoints: [resolve(plugin, "host.ts")],
  outdir: resolve(plugin, "dist"),
  target: "node",
  format: "esm",
  external: externals,
  naming: "host.mjs",
});

// The client half: a browser CJS module inside the loader frame, `plugins/dsh-texteda/lib/client.js`.
// `require` stays live for the platform modules, so React is the host's instance and not a second
// copy of it.
await build({
  entrypoints: [resolve(plugin, "client.ts")],
  outdir: resolve(plugin, "lib"),
  target: "browser",
  format: "cjs",
  external: ["react", "react/jsx-runtime", ...externals],
  naming: "client.js",
  intro: "var module = { exports: {} }; var exports = module.exports;",
  banner: 'window.__ModuleLoader__.load({ id: "@texteda/dsh-plugin", factory: (require) => {',
  footer: "return module.exports; } });",
});
