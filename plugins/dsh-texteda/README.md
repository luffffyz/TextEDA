# The TextEDA tools in a DeepSeek Harness session

A DSH plugin whose host half registers the TextEDA verbs — the same eight the command line has
— as tools the model can call.

## What it is

| | |
|---|---|
| The tools | the catalogue (`packages/cli/src/tools.ts`), projected onto DSH's flat parameter spec |
| The work | the verb itself: the same function the command line calls |
| The answer | one canonical JSON value; `output.render` is what the model reads |
| The build | `bun run scripts/build-dsh-plugin.ts` — one file, with our packages inside it |

The projection lives in `packages/cli/src/dsh-tools.ts`; `host.ts` is the adapter that registers
the tools with the host. There is no second implementation of anything.

## Building

```sh
bun run scripts/build-dsh-plugin.ts
```

The bundle is `plugins/dsh-texteda/dist/host.mjs`. It carries our packages — they are not
published (F53) — and leaves the host's own packages external, because the host provides them.

## Installing

```sh
dsh plugin --profile web add <package>
```

The package has to be somewhere the host can fetch: npm, or a git URL. Publishing the plugin is
tracked as F53; until then, install from a checkout.

## What the model sees

Eight tools, named after the commands: `texteda_check`, `texteda_view_metrics`,
`texteda_view_render`, `texteda_view_rewire`, `texteda_ir`, `texteda_netlist`, `texteda_bom`,
`texteda_export_gerbers`.

A tool that found something to report hands the report back, errors included. A tool that could
not do its work throws, and the host turns that into the error the model reads.

## The client half

Not here yet: the drawing surface belongs to the review app, and its place in a DSH session is
decided in [ADR-0142](../../docs/adr/view/0142-the-review-app-is-a-plugin-of-the-agent-workbench.md).
