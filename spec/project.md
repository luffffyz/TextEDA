# `project.toml`: project metadata

> Specification: the `project.toml` file every project has at its root — its tables, keys and defaults.
> Decision: the project tree it sits in (`docs/adr/03-project/0008-project-tree-has-owners.md`); the responsible person it names (`docs/adr/09-view/0037-review-records-and-attribution.md`); why there is no library table (`docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md`).

## 0. What it is

**`project.toml` holds project metadata only.** It does not hold the circuit — the circuit lives in
one project-level logical root, `design/sch/main.teda` (`spec/teda.md` §7), composed from module
definitions in `design/sch/modules/` and implemented by physical PCB descriptions in `design/pcb/` —
and it does not hold library references, because a project has no library dependencies (an external
library is a template: `texteda lib import` copies it into `assets/`, after which the files are the
project's own).

`texteda init <dir>` writes exactly three keys: `[project].name`, `version`, `format`. Everything
else is added by hand when it is needed.

## 1. Allowed keys

| Table | Keys | When |
|---|---|---|
| `[project]` | `name` `version` `format` | **Required**; `version` is the project version, `format` records the project's language version (current value: `spec/teda.md` §12.1) |
| `[project]` | `description` `license` `status` | Optional; `license` in SPDX form, `status` one of `draft` / `prototype` / `frozen` / `production` / `deprecated` |
| `[project]` | `owner` | Optional, but **required once review records exist**: the project's responsible person (creator, or whoever took it over). Only the owner may dispose of review comments ([ADR-0037](../docs/adr/09-view/0037-review-records-and-attribution.md)) |
| `[project]` | `default_variant` | With several variants; must point at a defined `[variants.<id>]` |
| `[[project.authors]]` | `name` `email` | Optional |
| `[project.links]` | `repository` `homepage` `issues` | Optional |
| `[boards.<id>]` | `revision` `title` | Metadata for a physical PCB, keyed by its `pcb_id` (`design/pcb/<pcb_id>.teda`); one entry per physical board, may be absent for a single-PCB project. Metadata only: it neither creates a board nor assigns modules — ownership is declared in the PCB file (`spec/pcb.md` §4.1) |
| `[variants.<id>]` | `dnp` `nofit` `alternates` | Variants; instance references use the stable `component_id`, never a refdes |
| `[compliance]` | `standards` `operating_temp` | Compliance targets |
| `[ext]` | anything | **The only place unknown keys are allowed** |

### Removed tables

| Table | Why it is gone |
|---|---|
| `[libs.<name>]` | A project does not reference an external library. Libraries are templates: `texteda lib import` copies files into `assets/` and they become the project's own ([ADR-0034](../docs/adr/08-libraries/0034-trust-in-a-library-you-do-not-own.md)). Reading `[libs.*]` now reports `syntax.unknown-field` |
| `[libs.<name>]` for a self-built library | The project's own assets are not a library either; they are referenced by bare id under `assets/` |

## 2. Rules

- **Unknown top-level keys are an error** (`ext` is the one exception).
- `format` records one project-level language version, not a per-description-type version or an
  assertion that every `.teda` file declares the same version. `texteda init` writes the current
  language version; existing files may keep an older accepted version if they use only constructs
  available at that version. Per-file acceptance is defined in `spec/teda.md` §12.3, and any new
  construct requires the version that introduced it (see [ADR-0002](../docs/adr/01-language/0002-one-language-version-number.md) D11).
- No timestamps, absolute paths, random IDs, secrets, or derived data (BOM / Gerber / checksums).
- `init` writes only `name` / `version` / `format`; everything else is added when needed.
- The logical shape of a project is fixed by the language, not by this file: **one** schematic root
  `design/sch/main.teda` owns the project's nets, ports, constraints and interconnects; module
  definitions in `design/sch/modules/<module_id>.teda` own every component fact; each module instance
  belongs wholly to exactly one physical PCB described by `design/pcb/<pcb_id>.teda`. Per-board
  metadata (`revision`, `title`) may be recorded here under `[boards.<id>]`, but it never creates
  or re-routes anything.
