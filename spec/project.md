# `project.toml`: project metadata

> Specification: the `project.toml` file every project has at its root — its tables, keys and defaults.
> Decision: the project tree it sits in (`docs/adr/0031-project-tree-ownership-model.md`); the responsible person it names (`docs/adr/0033-review-records-and-attribution.md`); why there is no library table (`docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md`).

## 0. What it is

**`project.toml` holds project metadata only.** It does not hold the circuit — that lives in
`design/**` — and it does not hold library references, because a project has no library dependencies
(an external library is a template: `texteda lib import` copies it into `assets/`, after which the
files are the project's own).

`texteda init <dir>` writes exactly three keys: `[project].name`, `version`, `format`. Everything
else is added by hand when it is needed.

## 1. Allowed keys

| Table | Keys | When |
|---|---|---|
| `[project]` | `name` `version` `format` | **Required**; `version` is the project version, `format` is the **language version** — the one number every `.teda` file in the project declares (current value: `spec/teda.md` §13.1) |
| `[project]` | `description` `license` `status` | Optional; `license` in SPDX form, `status` one of `draft` / `prototype` / `frozen` / `production` / `deprecated` |
| `[project]` | `owner` | Optional, but **required once review records exist**: the project's responsible person (creator, or whoever took it over). Only the owner may dispose of review comments ([ADR-0033](../docs/adr/0033-review-records-and-attribution.md)) |
| `[project]` | `default_variant` | With several variants; must point at a defined `[variants.<id>]` |
| `[[project.authors]]` | `name` `email` | Optional |
| `[project.links]` | `repository` `homepage` `issues` | Optional |
| `[boards.<id>]` | `revision` `title` | Multi-board or revisions; may be absent |
| `[variants.<id>]` | `dnp` `nofit` `alternates` | Variants; instance references use the stable `component_id`, never a refdes |
| `[compliance]` | `standards` `operating_temp` | Compliance targets |
| `[ext]` | anything | **The only place unknown keys are allowed** |

### Removed tables

| Table | Why it is gone |
|---|---|
| `[libs.<name>]` | A project does not reference an external library. Libraries are templates: `texteda lib import` copies files into `assets/` and they become the project's own ([ADR-0047](../docs/adr/0047-an-external-library-is-a-template-not-a-dependency.md)). Reading `[libs.*]` now reports `syntax.unknown-field` |
| `[libs.<name>]` for a self-built library | The project's own assets are not a library either; they are referenced by bare id under `assets/` |

## 2. Rules

- **Unknown top-level keys are an error** (`ext` is the one exception).
- `format` is the **language version**, not a per-description-type version: it is the number every
  `.teda` file in the project declares. The current value is in `spec/teda.md` §13.1, the acceptance
  rules in `spec/teda.md` §13.3.
- No timestamps, absolute paths, random IDs, secrets, or derived data (BOM / Gerber / checksums).
- `init` writes only `name` / `version` / `format`; everything else is added when needed.
- The board-level structure of a project is out of scope for this repository: this repository
  defines the language and the IR, not how a company lays out its projects.
