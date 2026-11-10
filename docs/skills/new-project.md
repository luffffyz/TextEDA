# Skill: Build a TextEDA Project from Scratch

> **Status**: maintained by hand. The original draft (2026-10-21) recorded commands and outputs from the then-current model; those runs are historical, not verification of the workflow below.
> **Historical follow-up**: the original proposal to script and gate this guide is preserved in §13 (F23).
> **Audience**: agents (humans can follow it too).
> **Endpoint**: the current workflow reaches a project-wide netlist, KiCad symbol/footprint libraries, and Gerber/Excellon files for a physical PCB. It does **not** export `.kicad_pcb` or `.kicad_sch` (see §10).

This file is English on purpose: a skill is an operating manual for an agent, not a design document
(see AGENTS.md §12).

Index: [`docs/skills/README.md`](README.md) lists the procedures and when to read which.

## 0. What this skill is for

Where a new project starts, what each file looks like, how the commands chain, and **which
diagnostic code to look at when it breaks**.

It is not a tutorial — a tutorial gives the order, this gives the "and now it failed, what do I
read". A step that does not say "on failure, look at code X" is not finished.

## 1. Prerequisites

- Note the repository path (written `REPO` below):

  ```sh
  REPO=/path/to/TextEDA
  ```

- **Two kinds of commands, run from different directories**:

  | Kind | Run from | Example |
  |---|---|---|
  | CLI commands (`init` / `id` / `check` / `compile` / `netlist` / `bom` / `export gerbers`) | the repository root, or anywhere (the project is a positional argument) | `bun run texteda check /tmp/demo` |
  | Repository scripts that touch the library (`compile:symbol` / `export:symbol` / `compile:footprint` / `export:footprint`) | **inside the project directory** (the script path points back at `$REPO`, the data paths are project-relative) | `cd /tmp/demo && bun run $REPO/scripts/export-symbol.ts dist/c.json --component assets/components/passives/cap-mlcc-0402.teda --out dist/c.kicad_sym` |

  Why the library scripts run inside the project: the `source.file` they write into the IR must be
  a path **relative to the current directory** (an IR contract requirement), and the data files
  live in the project anyway.

Core CLI commands used in this guide (`bun run texteda <subcommand>`):

| Command | What it does | Output |
|---|---|---|
| `texteda init <dir> [--force] [--name <project name>]` | Create project metadata and skeleton directories | `project.toml`, directory placeholders, and `docs/README.md` |
| `texteda id <project dir> [--count N] [--json]` | Print unused project-scoped instance UIDs | one UID per line or JSON |
| `texteda check <project dir> [--json]` | Check the project schematic and physical PCB descriptions | diagnostics (human readable or JSON) |
| `texteda compile <project dir> <board_id> [--json] [--out <file>] [--pcb] [--procurement]` | Compile the project root by default; `--pcb` selects a physical PCB description and `--procurement` its primary procurement description | IR JSON or diagnostics |
| `texteda netlist <project dir> [--json] [--out <file>]` | Project-wide connectivity projection | netlist |
| `texteda bom <project dir> <board_id> [--json] [--out <file>]` | Build the BOM for one physical PCB | BOM |
| `texteda export gerbers <project dir> <board_id> [--out <dir>] [--json]` | Export one physical PCB's manufacturing layers | Gerber and Excellon files |

The default `compile` mode always reads `design/sch/main.teda`. The CLI requires its second
positional `<board_id>` argument even in this mode, but it does not change the selected input unless
`--pcb` or `--procurement` is supplied. Symbol and footprint exports are repository scripts (§9)
that take IR JSON, not `.teda`; Gerber/Excellon export is the CLI command above.

## 2. Step 0: create the project

```sh
bun run texteda init /tmp/demo
```

`init` creates this skeleton (empty leaf directories contain `.gitkeep` placeholders):

```
project.toml
assets/
├── symbols/.gitkeep
├── footprints/.gitkeep
├── components/.gitkeep
└── procurement/
    ├── primary/.gitkeep
    └── alternatives/.gitkeep
external/
└── simulation/.gitkeep
design/
├── sch/.gitkeep
├── modules/.gitkeep
└── pcb/.gitkeep
views/.gitkeep
docs/README.md
```

`init` creates only `project.toml`, these directory placeholders, and `docs/README.md`; it creates
**no `.teda` source files**. The library files and circuit descriptions are yours to write (§3 and
§6). See [`spec/project.md`](../../spec/project.md) for the project metadata contract. The tree
follows ownership (AGENTS.md §9, ADR-0008): `assets/` is what the project owns,
`external/` is what it borrows, `design/` is the circuit, `views/` is project-wide drawing data, and
`docs/` is project documentation.

Two traps:

1. **`init` creates the tree, not the content**. The empty leaf directories have `.gitkeep`; parent
   directories contain their children. There is no pre-populated schematic, module, PCB, or view.
2. **`init` does not reach the network, fetch templates, or create `dist/`**. The output is
   deterministic: the same project name yields byte-identical files.

## 3. Step 1: the library (symbol + footprint)

The library holds the **view**; the component (§4) holds the pin facts. A project's own assets are
filed by a directory, not declared in a table (ADR-0008), and the directory is a **classification**
(ADR-0049): `assets/symbols/<category>/` (the device axis — the category the drawn part belongs to)
and `assets/footprints/<family>/` (the package family — its own axis). A component names them with
the same string as a prefix: `symbol passives:c`, `footprint chip:chip-0402`. Both are one level
deep; the class is not part of the id and is not written in the file.

A library the project does not own is a **template**: `texteda lib import <name> --from <dir> --rev
<tag> [--only <id>,…]` copies the devices you need into `assets/` under bare ids, keeping the class
directory the template filed the geometry under; see `docs/guides/library-import.md`. There is no
`external/libs/`: a template is imported from wherever the checkout is, and the copy is the project's own.

```sh
mkdir -p /tmp/demo/assets/symbols/passives /tmp/demo/assets/footprints/chip
```

`assets/symbols/passives/c.teda` (the symbol of a two-pin capacitor):

```
version 0.9.2
symbol c

description Non-polarized capacitor, 2-pin generic view
tags capacitor passive
field Reference at=0,2.54 U
field Value at=0,-2.54 c

pins
  1  -3.81  0  0
  2  3.81   0  180

body
  line  -1.27,-0.508,1.27,-0.508  width=0.254
  line  -1.27,0.508,1.27,0.508    width=0.254
```

`assets/footprints/chip/chip-0402.teda`:

```
version 0.9.2
footprint chip-0402

description 0402 (1005 metric) chip, generic land pattern
tags chip smd
attr smd
package_code 0402
field Reference at=0,-1.5 layer=F.SilkS size=1,1 thickness=0.15 REF**
field Value at=0,1.5 layer=F.Fab size=1,1 thickness=0.15 chip-0402

pads
  1  smd  roundrect  -0.5  0  0.6  0.6  rratio=0.25
  2  smd  roundrect  0.5   0  0.6  0.6  rratio=0.25

graphics
  rect  F.CrtYd  -0.9,-0.5,0.9,0.5    width=0.05
  rect  F.Fab    -0.5,-0.25,0.5,0.25  width=0.1
```

The full rules for writing library files are in `docs/guides/symbol-authoring.md` and
`docs/guides/footprint-authoring.md`; **the symbol's pin number set must match the component's**
([ADR-0031](../adr/08-libraries/0031-symbol-format.md), "the two pin number sets must be aligned").

## 4. Step 2: the devices

A device is **the pin facts** (number, name, electrical type) plus references to the library views,
and it says what kind of device it is. `kind` is never inferred (`value.component-kind-invalid`):

| `kind` | what it is | where it lives | `mpn` | `params` |
|---|---|---|---|---|
| `part` | one specific device, bought by part number | `assets/components/` | required | none |
| `generic` | one device class; the value lives in the instance row | `assets/components/` | forbidden | at least one required `value` |

A generic also declares its construction and whether it is polarised
(`value.component-generic-fact-invalid`).

`assets/components/passives/cap-mlcc-0402.teda`:

```
version 0.9.2
component cap-mlcc-0402

kind         generic
category     capacitor
construction mlcc
polarized    no
symbol passives:c
footprint chip:chip-0402

params
  value      capacitance required
  tolerance  percent     optional
  voltage    voltage     optional
  dielectric string      optional

pins
  1  A  passive
  2  B  passive
```

What matters:

- **The `component_id` is the file name** (without `.teda`, **without the relative path**):
  `assets/components/passives/cap-mlcc-0402.teda` has the id `cap-mlcc-0402`. The `component <id>` header must match the
  file name, otherwise `ref.component-id-mismatch`.
- **The kind is a fact of the file, not of the path**: parts and generics live in the same
  `assets/components/` tree, and a file that does not state its kind is an error
  (`value.component-kind-invalid`).
- The `params` section declares **the extra columns an instance row may carry** (name, type,
  required/optional). Their order is the order the instance row supplies them in.
- A module **must not define a device inline**; it references an id under `assets/components/`. A
  missing id is an error (`ref.unknown-component`) — no network lookup, no silent downgrade.
- **The pin table is the identity boundary**: only attributes that do not change a pin's electrical
  behaviour may be `params` (value, tolerance, voltage rating, ESR). The footprint is a fixed
  attribute, never a parameter; the package code is **not** in the device file at all — the
  footprint file states it (`package_code`, ADR-0028 decision 1).

## 5. Step 3: nothing to lock

A project's devices, symbols and footprints live under `assets/` and are the project's own
content. There is no library reference to pin: `project.toml` has no `[libs]` table (it was
withdrawn — [ADR-0034](../adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md)), and
`lib:verify` checks the assets directly rather than against a stored hash.

If the assets came from someone else's library, the copy was made with `texteda lib import`, and
each file carries one header comment saying where it came from. Editing the file is normal work;
to pick up a newer template, import again from the new revision and diff.

## 6. Step 4: the project root, modules, and physical PCBs

ADR-0069 defines one project-wide logical root: `design/sch/main.teda`. It composes reusable module
definitions from `design/modules/<module_id>.teda`; component instances, local nets, ports, and
constraints belong to those module definitions. The root declares module instances and project-wide
nets, ports, constraints, and explicit interconnects. It does not contain a board-local `instances`
table, and there are no active system descriptions or alternate schematic roots.

The following syntax example assumes both module definitions exist, expose the shown ports, and are
assigned to different physical PCBs. It is not a complete project produced by `init`:

```
version 0.14.0
schematic main

modules
  M1  IDp8x2n4  charger-power
  M2  buck-5v

nets
  GND:  M1.GND  M2.GND
  SYS:  M1.SYS_OUT  M2.SYS_IN

interconnects
  ic1  M1.SYS_OUT  M2.SYS_IN
```

The syntax and ownership rules are in [ADR-0069](../adr/03-project/0069-project-level-logical-root-and-physical-board-mapping.md),
[`spec/teda.md`](../../spec/teda.md) §7, and [`spec/module.md`](../../spec/module.md). A physical PCB
is separate: `design/pcb/<pcb_id>.teda` has a required `modules` section assigning each root module
instance to exactly one PCB. Reusing a module definition means instantiating it; one instance cannot
be split across PCBs.

A logical net shared by modules on different PCBs does **not** imply physical continuity. The root
must declare an `interconnects` entry between the module ports; optional `interconnect_pins` map
those logical endpoints to physical connector pins. Copper, placement, and board-local routing
remain in the corresponding physical PCB description. See [`spec/pcb.md`](../../spec/pcb.md) §4.1
and [`spec/teda.md`](../../spec/teda.md) §§7.5–7.7.

Print pages are also project-wide, with no PCB parent or per-board view directory. Each page lives
at `views/<page_id>.view.teda`; `views/main.view.teda` can serve as a topology overview showing
module boxes, ports, and explicit interconnects. Pages draw the project; they do not define circuit
connectivity or PCB ownership. See [`spec/schematic-view.md`](../../spec/schematic-view.md) §§0.2,
1.1, and 4.2–4.4.

## 7. Step 5: check → compile → netlist

The commands below assume the project root, module definitions, and physical PCB source files have
been authored; `init` creates only the empty directory skeleton. Then check the project:

```sh
bun run texteda check /tmp/demo
```

`check` validates the project schematic and its physical PCB descriptions. The three stages are
**parse** (syntax), **contract** (IR against the schema), and **design** (ERC); `--json` emits the
machine-readable payload (ADR-0003).

The default compile mode compiles only the fixed project root, `design/sch/main.teda`, and the
netlist is project-wide:

```sh
bun run texteda compile /tmp/demo main --out /tmp/demo/dist/schematic.json
bun run texteda netlist /tmp/demo
```

The CLI requires a second positional argument named `<board_id>` even in default root mode; `main`
fills that syntactic slot here, but without a selector it does not choose a physical PCB. `--out`
creates a missing parent directory (`init` itself does not create `dist/`). The netlist carries only
connectivity, not component parameters or footprints.

## 8. Step 6: source the parts (the procurement layer)

The design says what the project needs; procurement says what is bought for a **physical PCB**. It
is a decision, not a circuit fact, so it lives in its own file keyed by that PCB's id. A primary
procurement description applies to the module instances owned by that PCB and affects that build's
identity.

For the physical PCB described by `design/pcb/demo.teda`, the primary procurement file is `assets/procurement/primary/demo.teda`:

```
version 0.9.2
procurement demo
role primary

selections
  res-thick-0402  10k  ±1%  ->  rc0402fr-0710kl
```

The row reads `<generic> <requirement…> -> <part>`: the left side is the line the modules assigned
to this PCB require; the right side is the part that satisfies it. The part has to be a `kind: part`
device with a part number, the same land pattern as the generic, and ratings that meet the line.

See [`spec/procurement.md`](../../spec/procurement.md) for the procurement and BOM contracts.

```sh
bun run texteda check /tmp/demo
bun run texteda bom /tmp/demo demo
```

The CSV below is retained output from the original guide run; in the current model, the `demo`
argument names the physical PCB whose assigned module instances and procurement description feed
the BOM:

```
component_id,mpn,params,quantity,status,refdes,note
cap-mlcc-0402,,100nF 10% 16V dielectric=X7R,1,unsourced,C1,
res-thick-0402,RC0402FR-0710KL,10k 1%,1,bought,R1,
```

Three states: `bought` (the part is named), `unsourced` (the line exists, nobody chose a part —
the part number cell stays **empty**), and `not-required` (the row says `-> not-required`: there
is nothing to order for this line, which is different from "nobody has ordered it yet").

`texteda check` reports a line nobody sourced as a **warning**, not an error: an unfinished
sourcing is not a broken design.

A second source for that same physical PCB goes in `assets/procurement/alternatives/demo.teda`
(same syntax, `role alternatives`). It is advisory: switching to it does not change the build's
hash, and a broken row there is a warning instead of an error.

## 9. Step 7: export the KiCad library (two steps)

**The export scripts take IR JSON, not `.teda`** — compile first, then export. **Run them inside the
project directory** (§1):

```sh
cd /tmp/demo

# symbol: IR JSON + the component file (the pin facts come from the component)
bun run $REPO/packages/parser/scripts/compile-symbol.ts assets/symbols/passives/c.teda --out dist/c.json
bun run $REPO/scripts/export-symbol.ts dist/c.json --component assets/components/passives/cap-mlcc-0402.teda --out dist/c.kicad_sym

# footprint: IR JSON only
bun run $REPO/packages/parser/scripts/compile-footprint.ts assets/footprints/chip/chip-0402.teda --out dist/fp.json
bun run $REPO/packages/exporter/scripts/export-footprint.ts dist/fp.json --out dist/
```

Products: `dist/c.kicad_sym`, `dist/chip-0402.kicad_mod`.

`--component` is not optional: a symbol stores only "where to draw it and how", while **the pin
facts (number, name, electrical type) live in the component** (ADR-0031). The exporter merges them
by pin number, and the two pin number sets must match.

## 10. How far this goes, and what it cannot reach

| Wanted | Status today |
|---|---|
| Project-wide netlist | ✅ `texteda netlist` |
| KiCad symbol / footprint libraries | ✅ the two-step chain in §9 |
| Gerber / Excellon for a physical PCB | ✅ `texteda export gerbers <project dir> <board_id> [--out <dir>] [--json]` |
| `.kicad_pcb` board file | ❌ **there is no exporter in the repository**. The file in `docs/trial-run/charger-buck/` was produced by a one-off prototype (its README says "not in the repository"). The exporter is scoped in [F23](../backlog.md) step 5 |
| KiCad schematic (`.kicad_sch`) | ❌ ([F16](../backlog.md)) |

Gerber/Excellon export is implemented for a physical PCB description; the missing board-file
exporter means this skill does not produce a `.kicad_pcb`. These are separate output formats.

## 11. When it breaks

The diagnostic code registry is the single source of truth
(`packages/ir/src/diagnostics/codes.ts`; `bun run gen` renders `docs/error-codes.md`). These are the
ones you actually hit:

| Symptom | Code | Fix |
|---|---|---|
| `component res-thick-0403 not found` | `ref.unknown-component` | Put the device under `assets/components/` (a part or a generic), or fix the reference name (**no subdirectory**) |
| `The id declared in the file header is cap-mlcc-0402x, the file name is cap-mlcc-0402` | `ref.component-id-mismatch` | Make the header id and the file name agree |
| `a component file must declare its kind` | `value.component-kind-invalid` | Add `kind part` or `kind generic` |
| `a generic must declare its construction` | `value.component-generic-fact-invalid` | Add `construction` and `polarized` to the generic |
| the kind value `family` was renamed in 0.1.3 | `syntax.removed-construct` | Write `kind generic`; the part that fills it is chosen in the procurement layer |
| `component res-thick-0402 has 1 required parameters, but the row gives only 0` | `value.param-count-mismatch` | Supply as many values as the `params` section declares, in its order |
| `pin R1.2 belongs to both net MID and VCC2` | `net.pin-in-two-nets` | A pin belongs to one net; drop the extra member |
| `the language is at version 0.9.2: 0.10 is newer` | `format.unsupported-version` | Write the language's current version, or upgrade the tool. **The version rules are in `teda.md` §13** |
| `not a valid version number: 0.06` | `format.invalid-version` | A version is `MAJOR.MINOR[.PATCH]`, no leading zeros |
| `an instances row needs at least 2 columns: refdes component_id` | `syntax.row-too-short` | Fill in the missing columns |
| `invalid refdes: VCC` | `syntax.invalid-identifier` | A refdes looks like `R1` / `U12`; a net name is not a refdes |
| `net GND has only one member C1.2` | `drc.single-member-net` (warning) | Ignore it if the net really has one pin; otherwise something is not connected |
| A pin appears in no net | `net.pin-unassigned` (warning) | Connect it, or mark it `no_connect` in the component file |

When a parser reports a row or column error at a line that looks valid, inspect the section header
and data row above it: an unknown section name can be read as a data row, shifting the reported
location. Diagnose from the reported code and surrounding lines rather than only the highlighted
row.

## 12. Documentation checklist

- [ ] `init` is documented as creating only `project.toml`, skeleton directories/placeholders, and `docs/README.md`; no `.teda` files
- [ ] The sole logical root is `design/sch/main.teda`; reusable definitions live in `design/modules/`
- [ ] Each physical PCB is `design/pcb/<pcb_id>.teda` and owns each assigned module instance exactly once
- [ ] Cross-PCB paths are explicit root `interconnects`; project-wide view pages are flat under `views/`
- [ ] The CLI signatures and default root compile behavior match the current CLI
- [ ] Procurement and BOM guidance are scoped to a physical PCB
- [ ] The stated export endpoints match the implemented CLI and repository scripts

## 13. Historical follow-ups

The following notes preserve the original draft's follow-up list; check current implementation
before treating an item as open:

1. **Executable form**: `scripts/skill-new-project.ts` (build a minimal project → `check` with zero
   errors → export → assert the products exist and are byte-reproducible), plus
   `bun run skill:new-project` and a gate. See [F23](../backlog.md).
2. **Board file exporter** (`pcb` IR → `.kicad_pcb`): move the one-off prototype from
   `docs/trial-run/` into `packages/exporter`.
3. **Gerber / Excellon writer** (F15): this historical to-do has since been implemented as
   `texteda export gerbers`; see §10 for the current endpoint.
4. **Mark the dependency of every step**: the scripted version should mark each step's dependencies.
