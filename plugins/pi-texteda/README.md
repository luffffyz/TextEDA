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

The extension is a **pi-format module**: a host that loads pi extensions loads this one, with no
build step and no new dependency. The real-machine smoke ran once, on a host that is not part of
our toolchain, so there is no command that re-runs it today — treat that run as a record of how
the extension was verified, not as the way to run it; ask your host how it loads an extension, or
use the MCP route below, which needs no host-specific loader at all.

## What the model sees

Eight tools, named after the commands: `texteda_check`, `texteda_view_metrics`,
`texteda_view_render`, `texteda_view_rewire`, `texteda_ir`, `texteda_netlist`, `texteda_bom`,
`texteda_export_gerbers`.

A tool that found something to report hands the report back, errors included. A tool that could
not do its work says why, and the model can answer with different arguments.

## Why not the MCP server

pi speaks MCP too, so `texteda mcp` works there as well. The extension is the faster path: the
verbs run in the host's process, with no subprocess and no serialization step.
