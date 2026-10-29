# TextEDA in a DeepSeek Harness session

A DSH plugin with two halves. The host half registers the TextEDA verbs as tools the model can
call, and the two routes the picture asks its host for. The client half puts the review app in a
right-sidebar tab, so a person can read a print page and move a symbol inside the session that is
working on the project.

## What it is

| | |
|---|---|
| The tools | the catalogue (`packages/cli/src/tools.ts`), projected onto DSH's flat parameter spec |
| The work | the verb itself: the same function the command line calls |
| The answer | one canonical JSON value; `output.render` is what the model reads |
| The picture | `mountReview` from `@texteda/viewer` — the same app the standalone page runs |
| The write | the page's `place` rows, through the core's `planPlaces` / `applyPlaces` |
| The build | `bun run scripts/build-dsh-plugin.ts` — two files, with our packages inside them |

The projection lives in `packages/cli/src/dsh-tools.ts`; `host.ts` is the adapter that registers
the tools and the routes. There is no second implementation of anything.

## Building

```sh
bun run scripts/build-dsh-plugin.ts
```

Two bundles, because a host loads the two halves differently:

| Half | Output | Shape |
|---|---|---|
| host | `dist/host.mjs` | Node, ESM; our packages inside, the host's own packages external |
| client | `lib/client.js` | browser, CJS inside DSH's `__ModuleLoader__` frame; React stays the host's module |

Both are built, never edited: `plugins/dsh-texteda/dist/` and `lib/` are not tracked.

`bun run scripts/smoke-dsh-plugin.ts` builds both into `/tmp/texteda-dsh-smoke/` and applies them
to stand-in contexts: the tools must match the catalogue, the two routes must be the paths the
client half posts to, and the client half must register a tab type whose body is registered under
the type's own id.

## Installing

```sh
dsh plugin --profile web add <package>
```

The package has to be somewhere the host can fetch: npm, or a git URL. Publishing the plugin is
tracked as F53; until then, install from a checkout.

The picture half needs `web`: a terminal profile has no drawing surface (ADR-0142 D9).

## What the model sees

Eight tools, named after the commands: `texteda_check`, `texteda_view_metrics`,
`texteda_view_render`, `texteda_view_rewire`, `texteda_ir`, `texteda_netlist`, `texteda_bom`,
`texteda_export_gerbers`.

A tool that found something to report hands the report back, errors included. A tool that could
not do its work throws, and the host turns that into the error the model reads.

## What the person sees

A right-sidebar tab of kind `texteda-review`. Its body builds the model from the host's answer and
mounts the app; the project root is the session's `cwd`, so the tab reviews the project the session
is working in.

The tab offers `review` and `layout` only. `edit` is not offered: the source is the agent's to
write, and the plugin grants no route that writes it (ADR-0142 D3, D6).

### The two routes

DSH matches a route by its whole path — there are no wildcard segments — so the session travels as
a query parameter rather than in the path.

| Route | Method | Answer |
|---|---|---|
| `/api/texteda-review` | GET | the review model, `?sessionId=<id>` |
| `/api/texteda-review/places` | POST | the places-only write |

The write body is `{ board, page, places, commit }`. `commit: false` plans and draws; `commit: true`
writes the `place` rows and answers with the rebuilt model. Both answer `stale`: the nets whose
wires the move left behind. They are reported, never re-anchored — `texteda view rewire` is what
puts them back (ADR-0142 D10).

## Where the picture can live

Three routes, and only one of them is what this package is: a host-native plugin. The browser
(`texteda review` or its static export) needs no host code at all, and MCP Apps would need one
implementation for every host that renders them — but none of the hosts we support is on that
list yet, so it is tracked as F59. The census, and why exactly two hosts need their own drawing
code, is in `docs/plugin-hosts.md` and [ADR-0146](../../docs/adr/process/0146-the-picture-reaches-a-host-by-three-routes.md).
