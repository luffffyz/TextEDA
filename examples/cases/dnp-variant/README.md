# Case: a DNP project variant

This project describes one resistor divider and two build variants. The `default` variant fits the
whole design; `lite` marks the generic resistor component as do-not-place (`dnp`). The schematic and
its connectivity stay unchanged: variant state belongs to procurement and manufacturing, not to ERC
or the netlist.

## What it proves

| Claim | Where it lives | What the checker says |
|---|---|---|
| A project can name a default variant | `project.toml`: `[project].default_variant = "lite"` | the reference resolves to the declared variant |
| DNP is project metadata, not schematic connectivity | `project.toml`: `[variants.lite] dnp = ["res-thick-0402"]` | the project shard carries the DNP list; the board still has the same instances and nets |
| A DNP variant scopes a generic component by `component_id` | the `dnp` entry and the schematic instance use `res-thick-0402` | the component identity is stable and does not depend on the `R1` display name |
| Variants do not rewrite the logical design | `design/sch/dnp-variant.teda` | the netlist has the same two nets for both variants; no variant-specific ERC result is produced |

## What it deliberately leaves out

- **No PCB.** `bind.not-checked` is the standing note.
- **No procurement selection.** The generic resistor remains an unsourced design line; this case pins
  the project-level variant representation rather than inventing a second BOM input language.
- **No instance-scoped generic DNP.** The current project surface names component ids; the separate
  generic-instance scope described by ADR-0024 D5 is not silently added here.

## What this case pins

- `expected/ir/**`, `expected/manifest.json`, `expected/netlist.txt`: the project shard includes both
  variants and selects `lite`; the schematic remains the ordinary divider.
- `expected/diagnostics.json`: no error or warning, with the standing `design.stress-unknown` and
  `bind.not-checked` notes.
