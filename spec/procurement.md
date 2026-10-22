# `procurement`: which part to buy

> Specification: the `procurement` description type (since language 0.9), the selection rows that bind a device family to a purchasable part, and the two files a board's procurement state is written in.
> Decision: `docs/adr/0030-procurement-layer.md`; the device model it builds on: `docs/adr/0027-device-parts-families-and-library-dependencies.md`; the library trust rules: `docs/adr/0028-library-trust-and-derived-overrides.md`; the project tree: `docs/adr/0031-project-tree-ownership-model.md`.

## 0. What it is

**A procurement description says which part is bought. It does not say what the circuit needs, and it does not say what a part is.**

| | Design (`schematic`) | Procurement (`procurement`) | Library (`assets/components/`, `external/libs/`) |
|---|---|---|---|
| What it is | what the board is made of | what is bought for it | what a device is |
| File | `design/sch/<board_id>.teda` | `assets/procurement/{primary,alternatives}/<board_id>.teda` | `assets/components/**/<id>.teda`, `external/libs/<lib>/…` |
| Vocabulary | family **or** part | family → part | the family and the part |
| Standing | normative | primary: normative; alternatives: advisory | normative |
| If you delete it | the board loses its circuit | the board loses its sourcing | the devices are gone |

In one sentence: **the design says what is needed, the procurement layer says what is bought, the library says what a part is.** No file says two of those at once.

The selection is a **project decision**: it depends on what the project can buy, from which channel, at what price. It is not a property of the device, so it does not belong in a shared library, and it is not a property of the circuit, so it does not belong in the schematic.

## 1. File

```
version 0.9
procurement mcu-board
role primary
```

- The file lives at `assets/procurement/primary/<board_id>.teda` (the primary selections) or `assets/procurement/alternatives/<board_id>.teda` (the second sources). The tree is the one in
  [ADR-0031](../docs/adr/0031-project-tree-ownership-model.md) decision 1.
- The `board_id` in the file header must match the file name, otherwise it is an error (the same rule as `component` and `module`).
- The `board_id` must be a board of this project (a `schematic` file for it exists). A selection always belongs to a board, because a BOM is a board's
  ([ADR-0002](../docs/adr/0002-board-pages-and-bom.md)).
- `role` is `primary` or `alternatives`, and it must agree with the directory the file is in. The two files have the same grammar; only the role and the
  standing differ.
- The `procurement` type exists since language **0.9**; a file below 0.9 cannot be a `procurement` file. The type has its own version line, as every
  description type does (`teda.md` §13.1).

## 2. Sections

```
version 0.9
procurement mcu-board
role primary

selections
  cap-tantalum-7343 220uF 10V -> avx:avx-taj-220u-10v
  res-th-0402 10k 1% -> yageo-rc0402fr-0710kl
```

`selections` is the only section. There are no other sections, and no scalars other than `role`.

## 3. The row

```
<family_id> <parameter_value…> -> <part_id>
```

- **The left side is the BOM line key**: a family id (bare if the project owns it, qualified by the library name if it comes from a vendored
  library), followed by the values of the family's declared `params`, **in the family's declared order** — the same
  shape as an `instances` row. The family's `params` section is the only place that order is written down.
- **The right side is the part that is bought**: a project-owned asset by its bare id, or a vendored library item by its qualified id (`avx:avx-taj-220u-10v`).
- **`->` terminates the left side.** The parameter list has a length that depends on the family, so a reader cannot tell where the parameters stop without
  resolving the family; the separator makes the row readable on its own. `:` is already the nets-section token, `=` already binds a type to a value, and
  neither of them can terminate an open-ended list.

A row is one **BOM line**, not one instance. The same family with the same parameters may appear on the board twenty times; it gets one row.

### 3.1 A part needs no row

A selection always points **from a family to a part**. A device the design names as a part is already bought as itself:

```text
# design/sch/mcu-board.teda
instances
  U1 stm32l4:stm32f407vgt6
```

That part is the purchase, and the procurement layer says nothing about it. Only family lines appear in the selection table.

### 3.2 What a row must satisfy

| Check | Why |
|---|---|
| The family resolves, and it is a `kind: family` | A part may not be re-selected |
| The part resolves, and it is a `kind: part` | A family may not be selected as a part |
| The part has an `mpn` | Required of every part; this is what makes the row purchasable |
| The part's `params` declaration covers the family's — same names, same types | Otherwise the specification in the row cannot be carried by the part, and the BOM line would silently lose a column |
| The part's `footprint` equals the family's `footprint` | The land pattern is a **hard constraint** of the family; a selection that changes it is not a selection, it is a design change |
| The part is not a library item the project has shadowed | A derived copy replaces the library item it overrides; selecting the shadowed item would put the same device in the BOM twice ([ADR-0028](../docs/adr/0028-library-trust-and-derived-overrides.md)) |

The last two are the checks that make the layer worth having: they catch the case where a selection quietly alters the board.

## 4. The two files

| | Primary | Alternatives |
|---|---|---|
| File | `assets/procurement/primary/<board_id>.teda` | `assets/procurement/alternatives/<board_id>.teda` |
| Section | `selections` | `selections` |
| `role` | `primary` | `alternatives` |
| Rows per family line | exactly one | zero or more |
| Standing | normative — enters the project hash and the board hash | advisory — enters the advisory hash only |
| A broken row | error | warning (error in strict mode) |

The two files are separate files, not two sections of one file, because each file produces exactly one IR shard with exactly one classification
([ADR-0023](../docs/adr/0023-ir-layer-on-disk.md) decision 4). The primary is part of the build: a different primary part is a different build. An alternative
is not: the Gerbers are byte-identical, and a hash that moved for that reason would make every re-sourcing exercise look like a design change and invalidate a
manufacturing package that nothing had changed.

A family line with alternatives but no primary is **unsourced** (§5.2). Alternatives do not make a line sourced, because nothing has been decided.

## 5. The BOM

### 5.1 Three kinds of line

| Kind | Where it comes from | What it carries |
|---|---|---|
| A part line | the design names a part | that part's MPN |
| A family line with a selection | the design names a family, the selection names a part | the selected part's MPN |
| A family line without a selection | the design names a family, nothing selects it | **no MPN** — the line is unsourced |

The row key is uniform: **a BOM row is keyed by `(component_id, parameters)`, and a part has an empty parameter set**
([ADR-0030](../docs/adr/0030-procurement-layer.md) decision 6).

### 5.2 An unsourced line

A board may legitimately be designed but not yet sourced. The BOM then carries the line with an **empty MPN cell** and the marker `unsourced` in the
comment/status column.

The marker does not go into the MPN cell: the exported BOM is consumed by a parts ordering system
([ADR-0006](../docs/adr/0006-jlc-prototype-delivery.md)), and a part number that reads `unsourced` would be ordered as if it were a part. An empty cell plus
an explicit marker is both honest and consumable.

`texteda check` reports every unsourced family line as a **warning**: the design is valid, the procurement is incomplete, and the two must not be confused.
This is deliberately not an error — a gate that rejects unfinished sourcing would make the tool unusable while the circuit is still moving.

## 6. Canonical form

1. One section, `selections`; the header scalars come first, in the order `version`, type line, `role`.
2. Rows are sorted by the left key as text: the family id by ASCII order, then the parameter cells in order, each by ASCII order. (The IR sorts the
   resolved values numerically; a source file and its IR may order two rows differently, which `teda.md` §12 rule 9 allows.)
3. **Procurement rows are not column-aligned.** The columns of two rows mean different things — the first parameter of one family is not the first parameter
   of another — so aligning them would suggest a correspondence that does not exist. Cells are separated by a single space, and `->` is separated from the
   key by a single space.
4. A family line appears at most once in the primary file. A second row for the same family is an error; in the alternatives file, repeating the family is
   how a second and a third source are written.
5. One blank line between the header block and the section; no trailing whitespace; one newline at the end of the file.

## 7. Diagnostics

| Situation | Severity |
|---|---|
| Malformed source (unknown section, missing `->`, unparsable cell) | error, in either file — a source file that does not parse stops the write |
| `role` disagrees with the directory | error |
| A check of §3.2 fails in the **primary** file | error |
| A check of §3.2 fails in the **alternatives** file | warning; error in strict mode |
| A family line has no selection | warning (unsourced) |
| A selection names a part the design does not use | warning — a selection may be made for a revision that has not been drawn yet |
| A selected part comes from a library item with `provenance = generated` | warning; error in strict mode ([ADR-0028](../docs/adr/0028-library-trust-and-derived-overrides.md) decision 5) |

The asymmetry between the two files is about the **content of a row**, not about whether the file parses.

## 8. The IR

The procurement descriptions compile to one shard each:

| Source | Shard | Classification |
|---|---|---|
| `assets/procurement/primary/<board_id>.teda` | `boards/<board_id>/procurement.json` | normative |
| `assets/procurement/alternatives/<board_id>.teda` | `boards/<board_id>/procurement-alternatives.json` | advisory |

The primary shard is a board shard, so it takes part in the board hash: changing the part a board is built from changes that board's identity, and the review
of that board has to be redone. The alternatives shard is not in the board hash and not in the project hash.

The shard's shape is specified in `schemas/ir/v0.3/procurement.schema.json`, which is written together with the contract v0.3 batch
([ADR-0008](../docs/adr/0008-ir-shard-identity-and-hash.md) decision 1, and `docs/backlog.md` F25 / F27 / F28). **There is no producer yet**: the
`procurement` type is specified but not implemented, so no procurement shard is written to `dist/ir/` today.

## 9. What is not in here

Packing form, supplier, price, minimum order quantity and lead time are **not** in the procurement description. They are commercial facts about a purchase,
not facts about the design, and a BOM that carries them becomes a document that changes weekly and belongs to purchasing
([ADR-0030](../docs/adr/0030-procurement-layer.md) decision 9).

## 10. Examples

### 10.1 A board with one selection

```
version 0.9
procurement mcu-board
role primary

selections
  cap-tantalum-7343 220uF 10V -> avx:avx-taj-220u-10v
  res-th-0402 10k 1% -> yageo-rc0402fr-0710kl
```

```
version 0.9
procurement mcu-board
role alternatives

selections
  cap-tantalum-7343 220uF 10V -> kemet:tae-227k-010-v-w
  cap-tantalum-7343 220uF 10V -> vishay:593b-2272-103-t
  res-th-0402 10k 1% -> vishay:rc0402fr-0710kl
```

### 10.2 A family line that is not sourced yet

```
version 0.9
procurement mcu-board
role primary

selections
  res-th-0402 10k 1% -> yageo-rc0402fr-0710kl
```

The board uses `ind-shielded-6045 10uH 20%` and nothing selects it: the BOM carries that line with an empty MPN and the marker `unsourced`, and
`texteda check` warns about it. The design is still valid.
