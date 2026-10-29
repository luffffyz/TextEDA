# The TextEDA tools in a pi session

A pi extension whose factory registers the TextEDA verbs — the same eight the command line has
— as tools the model can call.

## What it is

| | |
|---|---|
| The tools | the catalogue (`packages/cli/src/tools.ts`), projected onto pi's schema dialect |
| The work | the verb itself: the same function the command line calls |
| The answer | the value the command line prints with `--json`, field for field |
| The build | none — pi loads TypeScript directly |

The projection lives in `packages/cli/src/pi-tools.ts`; this file is the adapter that hands it to
the host. There is no second implementation of anything.

## How to load it

```sh
omp --extension plugins/pi-texteda
```

Or, to have it in every session, put a link to it where pi looks for tools:

```sh
ln -s "$PWD/plugins/pi-texteda/index.ts" ~/.omp/agent/tools/texteda.ts
```

## What the model sees

Eight tools, named after the commands: `texteda_check`, `texteda_view_metrics`,
`texteda_view_render`, `texteda_view_rewire`, `texteda_ir`, `texteda_netlist`, `texteda_bom`,
`texteda_export_gerbers`.

A tool that found something to report hands the report back, errors included. A tool that could
not do its work says why, and the model can answer with different arguments.

## Why not the MCP server

pi speaks MCP too, so `texteda mcp` works there as well. The extension is the faster path: the
verbs run in the host's process, with no subprocess and no serialization step.
