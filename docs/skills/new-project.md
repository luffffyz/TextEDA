# Skill: Build a TextEDA Project from Scratch

> **Status**: first draft (2026-10-21). Every command below has been run; the outputs are copied from real runs (see the checklist in §11).
> **No executable form yet** — scripting it and gating it are steps 2 and 3 of [F23](../backlog.md); this file is maintained by hand for now.
> **Audience**: agents (humans can follow it too).
> **Endpoint**: today it reaches a **netlist + `.kicad_sym` + `.kicad_mod`**; it does **not** reach `.kicad_pcb` or Gerber (why, in §9).

This file is English on purpose: a skill is an operating manual for an agent, not a design document
(see AGENTS.md §12).

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
  | CLI commands (`init` / `check` / `compile` / `netlist`) | the repository root, or anywhere (the project is a positional argument) | `bun run texteda check /tmp/demo` |
  | Repository scripts that touch the library (`libhash` / `compile:symbol` / `export:symbol` / `compile:footprint` / `export:footprint`) | **inside the project directory** (the script path points back at `$REPO`, the data paths are project-relative) | `cd /tmp/demo && bun run $REPO/scripts/export-symbol.ts dist/c.json --component assets/components/passives/cap-mlcc-0402.teda --out dist/c.kicad_sym` |

  Why the library scripts run inside the project: the `source.file` they write into the IR must be
  a path **relative to the current directory** (an IR contract requirement), and the data files
  live in the project anyway.

- The four CLI commands (`bun run texteda <subcommand>`):

| Command | What it does | Output |
|---|---|---|
| `texteda init <dir>` | Scaffold an empty project | directories + `project.toml` |
| `texteda check <dir>` | Parse → contract validation → ERC | diagnostics (human readable; `--json` for machines) |
| `texteda compile <dir> <board>` | One board file → board-level IR | IR JSON (stdout, or `--out`) |
| `texteda netlist <dir>` | The connectivity projection of the IR | netlist text |

- **The CLI has no `export` subcommand**: KiCad symbol/footprint export goes through repository
  scripts (§8), and those take the **IR JSON**, not the `.teda` file.

## 2. Step 0: create the project

```sh
bun run texteda init /tmp/demo
```

```
Created project demo: /tmp/demo
```

What you get (**and nothing else**):

```
project.toml
assets/symbols/  assets/footprints/  assets/components/
assets/procurement/{primary,alternatives}/
external/{libs,simulation}/
design/{sch,pcb,modules,system}/  views/  docs/README.md
```

Two traps:

1. **`init` creates the tree, not the content** — every directory above comes back empty (a
   `.gitkeep` each). The library files themselves are yours to write (§3). The tree is organised by
   ownership (AGENTS.md §9, ADR-0031): `assets/` is what the project owns, `external/` is what it
   borrows, `design/` is the circuit, `views/` is the drawings.
2. **`init` does not reach the network, does not fetch templates and does not create `dist/`**. The
   output is deterministic: the same project name yields byte-identical files.

## 3. Step 1: the library (symbol + footprint)

The library holds the **view**; the component (§4) holds the pin facts. The directories are declared
in `project.toml` under `[libs]`, and the convention is to reference them with the `project:` prefix.

```sh
mkdir -p /tmp/demo/assets/symbols/project /tmp/demo/assets/footprints/project
```

`assets/symbols/project/c.teda` (the symbol of a two-pin capacitor):

```
version 0.5
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

`assets/footprints/project/chip-0402.teda`:

```
version 0.4.1
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

The full rules for writing library files are in `docs/symbol-authoring.md` and
`docs/footprint-authoring.md`; **the symbol's pin number set must match the component's** (§4).

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
version 0.1.3
component cap-mlcc-0402

kind         generic
category     capacitor
construction mlcc
polarized    no
symbol project:c
footprint project:chip-0402

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
- A schematic **must not define a device inline**; it references an id under `assets/components/`.
  A missing id is an error (`ref.unknown-component`) — no network lookup, no
  silent downgrade.
- **The pin table is the identity boundary**: only attributes that do not change a pin's electrical
  behaviour may be `params` (value, tolerance, voltage rating, ESR). The footprint is a fixed
  attribute, never a parameter; the package code is **not** in the device file at all — the
  footprint file states it (`package_code`, ADR-0029 decision 1).

## 5. Step 3: lock the library in `project.toml`

A self-built library has no upstream version, so it is anchored by a **content hash** (ADR-0010).
Add to `project.toml`:

```toml
[libs.project]
source = "project"
symbols = "symbols/project"
footprints = "footprints/project"
content_hash = "<computed>"
```

Compute the hash **inside the project directory, with project-relative paths** (the paths are part
of the hash, so absolute paths give a different value):

```sh
cd /tmp/demo && bun run $REPO/scripts/libhash.ts symbols/project footprints/project
```

```
d35415857b0258602d2f2c0b7c06df25aa6870159807f2f946d34055280314cc
2 files, 2 roots
```

The first line is the hash; paste it into `content_hash`. **Recompute it whenever a library file
changes** — `lib:verify` reports the mismatch.

## 6. Step 4: the schematic

One board file `design/sch/demo.teda` (a board is one schematic file; see `teda.md` §7):

```
version 0.2
schematic demo

instances
  R1  res-thick-0402  10k
  R2  res-thick-0402  10k
  C1  cap-mlcc-0402  100nF

nets
  VCC  R1.1 C1.1
  MID  R1.2 R2.1
  GND  R2.2 C1.2
```

- An `instances` row is `refdes  component_id  <param values…>`; the number and order of the values
  come from the component's `params` section (§4).
- A `nets` row is `net_name  <pin>…`, where a pin is written `refdes.pin_number` — the **number**,
  not the name (names are ambiguous on alternate functions).
- A pin belongs to exactly one net (`net.pin-in-two-nets`).
- **A board may be composed of modules** (`design/modules/<module_id>.teda` + a `modules` section in the
  board file, `spec/module.md`). A board that fits in one file needs none — modules are optional.

## 7. Step 5: check → compile → netlist

```sh
bun run texteda check /tmp/demo
```

```
Checked 1 boards: 0 errors, 0 warnings (stages: parse 0 · contract 0 · design 0)
```

The three stages are **parse** (syntax), **contract** (IR against the schema) and **design** (ERC).
`--json` emits the machine-readable payload (ADR-0016).

```sh
bun run texteda compile /tmp/demo demo --out /tmp/demo/dist/schematic.json
bun run texteda netlist /tmp/demo
```

```
# netlist demo (ir 0.1)
GND: C1.2 R2.2
MID: R1.2 R2.1
VCC: C1.1 R1.1

# components 3
C1 cap-mlcc-0402
R1 res-thick-0402
R2 res-thick-0402
```

A missing parent directory of `--out` is **created for you** (`dist/` is created by the export
commands, not by `init`).

The netlist is only the **connectivity projection**: topology, no values and no footprints (those
belong to the BOM).

## 8. Step 6: export the KiCad library (two steps)

**The export scripts take IR JSON, not `.teda`** — compile first, then export. **Run them inside the
project directory** (§1):

```sh
cd /tmp/demo

# symbol: IR JSON + the component file (the pin facts come from the component)
bun run $REPO/packages/parser/scripts/compile-symbol.ts symbols/project/c.teda --out dist/c.json
bun run $REPO/scripts/export-symbol.ts dist/c.json --component assets/components/passives/cap-mlcc-0402.teda --out dist/c.kicad_sym

# footprint: IR JSON only
bun run $REPO/packages/parser/scripts/compile-footprint.ts footprints/project/chip-0402.teda --out dist/fp.json
bun run $REPO/packages/exporter/scripts/export-footprint.ts dist/fp.json --out dist/
```

Products: `dist/c.kicad_sym`, `dist/chip-0402.kicad_mod`.

`--component` is not optional: a symbol stores only "where to draw it and how", while **the pin
facts (number, name, electrical type) live in the component** (ADR-0012). The exporter merges them
by pin number, and the two pin number sets must match.

## 9. How far this goes, and what it cannot reach

| Wanted | Status today |
|---|---|
| Netlist (connectivity) | ✅ `texteda netlist` |
| KiCad symbol / footprint libraries | ✅ the two-step chain in §8 |
| `.kicad_pcb` board file | ❌ **there is no exporter in the repository**. The file in `docs/trial-run/charger-buck/` was produced by a one-off prototype (its README says "not in the repository"). The exporter is scoped in [F23](../backlog.md) step 5 |
| Gerber / Excellon | ❌ no writer yet ([F15](../backlog.md)) |
| KiCad schematic (`.kicad_sch`) | ❌ ([F16](../backlog.md)) |

**The skill must not pretend it reaches Gerber.** A step whose dependency is missing ends at "this
is as far as it goes".

## 10. When it breaks

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
| `version 0.9 is newer than the 0.7 supported by this tool` | `format.unsupported-version` | Lower the file version, or upgrade the tool. **The version rules are in `teda.md` §13** |
| `not a valid version number: 0.06` | `format.invalid-version` | A version is `MAJOR.MINOR[.PATCH]`, no leading zeros |
| `an instances row needs at least 2 columns: refdes component_id` | `syntax.row-too-short` | Fill in the missing columns |
| `invalid refdes: VCC` | `syntax.invalid-identifier` | A refdes looks like `R1` / `U12`; a net name is not a refdes |
| `net GND has only one member C1.2` | `drc.single-member-net` (warning) | Ignore it if the net really has one pin; otherwise something is not connected |
| A pin appears in no net | `net.pin-unassigned` (warning) | Connect it, or mark it `no_connect` in the component file |

One symptom that is easy to misread: **a misspelled section name is reported as a column error on
the wrong row**. The parser keeps reading the unknown line as a data row, so the error lands on the
row after it. Writing `netss` instead of `nets` reports `instances row needs at least 2 columns`.
When a "column error" points at a row that looks fine, look at the **line above it** first.

## 11. Checklist (run this after changing the skill)

- [ ] `init` produces exactly §2 (nothing more, nothing less)
- [ ] The library directories are created **by hand**, not expected from `init`
- [ ] The component file name matches the header id; the `params` section matches the instance
      row's column count
- [ ] `content_hash` was computed **inside the project directory** and pasted back into
      `project.toml`
- [ ] `check` reports zero errors
- [ ] `compile` produces the IR; `netlist` produces the connectivity
- [ ] The symbol export carried `--component`; both pin number sets match
- [ ] The library scripts ran **inside the project directory** (`$REPO/...` points back at the repo)
- [ ] No step depends on a command that does not exist in the repository (§9 is accurate)

## 12. Still to do

1. **Executable form**: `scripts/skill-new-project.ts` (build a minimal project → `check` with zero
   errors → export → assert the products exist and are byte-reproducible), plus
   `bun run skill:new-project` and a gate. See [F23](../backlog.md).
2. **Board file exporter** (`pcb` IR → `.kicad_pcb`): move the one-off prototype from
   `docs/trial-run/` into `packages/exporter`.
3. **Gerber / Excellon writer** (F15); only then does this skill's endpoint move from netlist to
   manufacturing files.
4. **Mark the dependency of every step**: this file currently lists the missing endpoints in §9;
   once it is scripted, each step should carry its own "what this depends on" marker.
