// Bundle the DSH plugin's host half.
//
// DSH loads a plugin's host half as one file. Our packages are not published (F53), so the
// bundle carries them; the host's own packages stay external, because the host provides them.
//
// The output is not tracked: it is built, not written by hand.
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const result = await Bun.build({
  entrypoints: [resolve(root, "plugins/dsh-texteda/host.ts")],
  outdir: resolve(root, "plugins/dsh-texteda/dist"),
  target: "node",
  format: "esm",
  external: ["@deepseek-ai/cordis", "@deepseek-ai/dsh-tools"],
  naming: "host.mjs",
});

if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

for (const artifact of result.outputs) {
  console.log(`${artifact.path} — ${artifact.size} bytes`);
}
