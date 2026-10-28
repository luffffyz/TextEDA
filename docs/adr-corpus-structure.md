# The Shape of the Decision-Record Corpus — the 2026-10-27 Restructuring

**Status: adopted and carried out.** The 56 flat records under `docs/adr/` became the 41 records
in topic folders, in the commit "docs: file the decision corpus in topic folders". §1–§7 describe
the reasoning and the resulting shape; §8 is the old-to-new map, kept because a retired number is
never handed out again and the map is the only way to follow a citation written before the swap.
The rules themselves live where they are enforced: the record shape in `AGENTS.md` §12, the
numbering and retired range in `docs/adr/README.md`, each folder's scope in its own `README.md`.

## 1. What was wrong with the corpus before the swap

The corpus was written in eight days (2026-10-20 → 2026-10-27) and grew to 56 records in one flat
directory. Measured facts:

| Fact | Count |
|---|---|
| Decision records | 56 |
| Records carrying a dated section | 32 (69 sections: 53 `Addendum`, 5 `Amendment`, 11 `Appendix`) |
| Total lines | 9,801 |
| `ADR-NNNN` citations in Markdown | 1,663 in 89 files |
| `ADR-NNNN` citations in code and contracts | 830 in 178 `.ts` / `.json` files |
| Citations inside the corpus itself | 840 — every record is cited by another record |
| Records that are already retired (superseded) | 2 |

Three problems follow from that shape, not from the content:

1. **A record has no stated scope.** Each one answers "what did we decide", never "which questions
   does this record answer, and which does it not". So overlap between records is invisible: the
   reader cannot tell whether a question is already answered somewhere else, or is genuinely open.
2. **Corrections accumulate as history.** 69 dated sections carry 1,910 lines of dated
   corrections. They are append-only by rule, so the corpus can only grow, never converge. The
   link gate already flags the symptom: an addendum block over 40 % of a record is a warning, and
   10 records are over it.
3. **Order carries no information.** The numbering is chronological, so "the newest decision about
   X" requires a search, and the directory listing is a flat list of 56 names in creation order.

## 2. The classification axis

A record lands in a folder by **what the decision governs**, not by the layer it mentions, not by
the artifact it produces, and not by when it was written.

- A decision that mentions a schematic *and* a pcb is a decision about the boundary between them,
  so it goes where boundaries live, not in either side.
- A decision about how a number is written belongs to the language, whether it appears in a
  schematic, a pcb, or a device file.
- A decision about a file format belongs to the artifact, not to the workflow that produces it.

Each folder therefore answers three questions in its README: **what it decides**, **what it does
not decide (and where that lives instead)**, and **in what order to read it**.

## 3. The folders

Ten folders, 41 records, 3 to 6 records each. Sizes are kept in that band on purpose: a folder
with one record is a folder that should be a section, and a folder with nine is a folder hiding a
second axis.

| Folder | Decides | Does not decide (lives in) | Records |
|---|---|---|---|
| `language/` | The surface of the language: what a fact layer may contain, how versions are numbered, how diagnostics are named, how a diagnostic points at source | The IR's representation (`ir/`), the tools (`process/`) | 4 |
| `ir/` | The typed IR: its semantic model, its canonical serialization, its shard tree and hashes, what enters it | Units and canonical detail (`spec/teda.md` §12, not a record) | 3 |
| `project/` | The project as a tree of description types: who owns which directory, how boards and modules compose, what identifies an instance, how a global rename is executed | Logical connectivity (`schematic/`), physical facts (`pcb/`) | 4 |
| `schematic/` | The logical board: one flat schematic, what flattening does to nets, how modules compose, which description has authority over connectivity | How a view is drawn (`view/`), how copper implements a connection (`pcb/`) | 4 |
| `pcb/` | The physical board: its segment set, what a partial layout means, what a declared connection requires of copper, how layout and routing are produced, how copper fill is computed | Manufacturing artifacts (`manufacturing/`), the copper fill's tolerance rules (`spec/pcb.md`) | 5 |
| `manufacturing/` | What leaves the tool: the output path, the target form of the package, the zero-dependency rule, prototype delivery | Which part to buy (`devices/`), the electrical rules (`schematic/`, `pcb/`) | 3 |
| `devices/` | Device semantics: `part` vs `generic`, the parameter vocabulary and roles, ratings and how they are checked, the package code, the procurement layer | File formats of symbols and footprints (`libraries/`) | 6 |
| `libraries/` | Symbols and footprints: our own formats, where geometry lives, which library is trusted at which revision | Device electrical facts (`devices/`) | 5 |
| `view/` | The drawing layer: the view as an independent description, the reference renderer, review records and who is accountable for them | What the view draws (`schematic/`, `pcb/`) | 3 |
| `process/` | How the project works: the implementation stack, the agent's entry point, licensing and openness, what stays outside the language, how documentation is governed | The language's rules (`language/`), the record corpus's own layout (this proposal) | 4 |

## 4. Numbering

- **One flat counter.** The corpus has a single sequence of numbers, handed out in the order the
  records are written: `0100`, `0101`, `0102`, … A number says one thing only: which record it
  names. What the record is *about* is said by the folder — a path, not a number.
- **The sequence is not contiguous, and is not meant to be.** Gaps are normal. A number is
  consumed by every record ever written, and a retired record's number is never handed out
  again. The forty-one records of the first corpus happen to come out grouped by folder, because
  they were written folder by folder; that is a fact about this corpus, not a rule.
- **A number is never changed and never reused.** This is the property that makes the corpus
  citable: a link to `ADR-0105` names the same decision forever. So a new record never disturbs
  the numbers of the existing ones — it takes the next free number, whatever folder it is filed
  in — and a record that is re-filed keeps its number.
- **The new series never reuses a retired number.** `0001`–`0056` are retired, not renamed into
  `0100`–`0140`. The reason is mechanical: if a new record were numbered `0022`, one missed
  reference rewrite would silently point at a *different* decision, and no gate could see it.
  With a disjoint range, a missed rewrite is a link to a number that does not exist — the link
  gate's rule "an ADR-NNNN is mentioned but there is no decision record for it" fires immediately.
- Retired numbers are **not** listed in the index's reserved table. Reserved means "declared, not
  written yet"; retired means "written once, gone now". Keeping retired numbers out of the
  reserved table is what makes a stale citation an error instead of a silence.
- **A folder gets a place, not a number.** The folders are named, not numbered; their order is
  the reading order stated in each folder's README. Adding a folder adds a path and a README and
  changes no number.

### The rejected alternative: a number per folder

The obvious alternative is a **two-part identifier** — a folder number and a per-folder counter,
so that a record is `ADR-01-03` with `01` naming the folder. It gives the same
insertion-locality, and it costs more than it saves:

- The folder becomes part of a record's **identity**. A record that is re-filed — and re-filing
  is normal here: the corpus is eight days old and the mapping in §8 re-files a third of it —
  must be renumbered, and a renumbering breaks every *prose* citation of it. Those are the ones
  in code comments and in the `description` fields of the published IR contract: 830 of them,
  hand-maintained, because no script rewrites a comment.
- It buys nothing the path does not already say. `language/0100-fact-layer.md` states the topic
  twice, and a reader has to know the scheme to read the number at all.
- It makes the number unreadable in the one place numbers are read most: a citation. `ADR-0105`
  is a handle; `ADR-01-05` is a coordinate in a scheme the reader must look up.

A flat counter gives the same insertion-locality with no coupling, because the number was never
tied to the folder in the first place. The cost of dropping the blocks is only that the number
stops sorting by topic — and the folder already sorts by topic, and the index is per folder.

## 5. The record format

```markdown
# ADR-0100: Title of the decision

Status: Accepted
Date: 2026-10-27
Scope: Decides: <one claim that can be checked against the code or the specs>. Does not decide: <the neighbouring question, and where it is answered>.
Related: ADR-0101, ADR-0104
Impact: `spec/teda.md` §13; `packages/parser/src/version.ts`; `scripts/check-links.ts`
```

- `Scope:` is mandatory and is one sentence in a fixed shape: **what it decides** and **what it
  does not decide**. "Does not decide" always names where the neighbouring question is answered.
  A scope that cannot be checked against something concrete is not a scope.
- `Status:` stays the closed vocabulary the link gate already enforces (`Accepted`, `Proposed`,
  plus the retired forms).
- `Date:` is the date of the decision, not the date of the last edit.
- `Related:` lists the records a reader needs next. It is the only cross-reference mechanism, and
  it is symmetric: if A lists B, B lists A.
- `Impact:` names the files the decision constrains, as today.
- The body keeps today's shape: `## Background`, `## Decision`, and consequences. It is written in
  the present tense, as a statement of what is now true.

### 5.1 Corrections are folded, not appended

Under the current rules a correction is a dated addendum appended to the record. That is how the
corpus reached 69 dated sections and 10 records over the 40 % addendum threshold. In the new
corpus:

- A record states what is true. A statement that later turns out to be wrong is **corrected in
  place** — the sentence is replaced, and the replacement carries the date in the record's
  `Date:` history only if the correction changes the decision itself.
- The dated addendum mechanism is kept for one case only: a record that is **retired**. A retired
  record is a stub — `Status:` names the record that supersedes it, and the decision text lives in
  git history. The link gate already has exactly this rule (a retired record keeps no body), so
  the corpus inherits it rather than inventing it.
- The cost of this choice is that the corpus stops being a history. The history is in git, and
  that is where a reader looks for "what did we believe in October".

## 6. The folder README

Each folder carries a `README.md` with four parts:

```markdown
# <Folder> — decisions

## Scope
What this folder decides, in one paragraph.

## Not here
The questions that are decided elsewhere, and where they are decided. Each line is a pointer:
`[ADR-0107](../project/0107-....md)`.

## Reading order
1. ADR-XXXX — why it comes first.
2. ADR-XXXX — ...

## Records
| Record | Title | Status | Date |
|---|---|---|---|
| [ADR-0100](0100-....md) | ... | Accepted | 2026-10-27 |
```

The README states scope, not decisions. A rule that belongs to a record lives in the record; the
README only says which records own which part of the topic, and where the neighbours are.

## 7. The index

`docs/adr/README.md` stays the single complete index, restructured as one section per folder, one
table per section, with the same four columns the link gate parses today (link, title, status,
date). The folder is expressed by the section, so the index needs no new column and the gate's
index parser needs no change. The index additionally states:

- the retired range `0001`–`0056` and that it is retired, not reserved;
- the reserved table for numbers declared but not yet written (the mechanism the gate already
  supports);
- the numbering rule: one flat counter, next free number, never reused, never changed.

## 8. The mapping

Every current record appears exactly once below, except `0002`, whose surviving part is split
between two records and whose superseded part is dropped. Two records are dropped outright because
they are already superseded (`0007` by `0025`, `0046` by `0047`).

The new numbers run `0100`–`0140` with no gaps. They are allocated in the order the records are
written, and the records are written folder by folder, so the numbers *happen* to group by
folder — a fact about this corpus, not a rule (§4). The next record written takes `0141`, and it
goes in whatever folder it belongs to.

### `language/`

| New | Title | From | Note |
|---|---|---|---|
| 0100 | The Fact Layer Has No Expressions; Generators Live Outside the Language | 0017 | unchanged |
| 0101 | One Language Version Number | 0022 + 0056 | merged: the version policy and the merge that replaced nine per-type lines |
| 0102 | Diagnostic Error Code Registry (`domain.slug`) | 0016 | unchanged |
| 0103 | Source Spans — Diagnostics Point at the File, the IR Stays Clean | 0020 | unchanged |

### `ir/`

| New | Title | From | Note |
|---|---|---|---|
| 0104 | IR Representation (Semantic Model / Contract / Serialization) | 0004 | unchanged |
| 0105 | IR Sharding, Identity Keys, and Hashes | 0008 + 0023 | merged: sharding and the on-disk layer are one decision; the units half stays in `spec/teda.md` §12 |
| 0106 | A Device's Description Is a Fact, So It Enters the IR | 0042 | unchanged |

### `project/`

| New | Title | From | Note |
|---|---|---|---|
| 0107 | The Project Tree Has Owners | 0031 | unchanged |
| 0108 | How Boards Are Linked Together | 0001 | unchanged |
| 0109 | Instance Identity Is a Stable Project-Local UID, Not the Refdes | 0051 | unchanged |
| 0110 | Renumbering Is a Code-Executed Global Rename, Not an Agent Edit | 0050 | unchanged |

### `schematic/`

| New | Title | From | Note |
|---|---|---|---|
| 0111 | One Flat Schematic per Board, Pages Become Print Pages in the View Layer | 0024 + 0025 | merged: the flat board, the print pages, and the level tags in flattened names are one naming decision; absorbs `0007`'s net-set rule |
| 0112 | A Board Is Composed of Modules; the IR Stays Flat | 0026 | unchanged |
| 0113 | Connectivity Has One Authority; Reverse Engineering Is an Import, Not a Mode | 0035 | unchanged |
| 0114 | Flattening and the Net Set | 0002 | split: the flattening half only; the BOM-counting half moves to `0128` |

### `pcb/`

| New | Title | From | Note |
|---|---|---|---|
| 0115 | Agent-First PCB Description (Segment Set and Trade-offs) | 0003 | unchanged |
| 0116 | Layout and Routing Are Agent-Driven, Checker-Gated, and Frozen on Acceptance | 0053 | unchanged |
| 0117 | Copper Fill Uses a Self-Built Constrained Geometry Kernel | 0054 | unchanged |
| 0118 | A Partial Layout Is Legal, and It Is Reported | 0040 | unchanged |
| 0119 | A Declared `connect` Pair Must Be Implemented by Copper | 0041 | unchanged |

### `manufacturing/`

| New | Title | From | Note |
|---|---|---|---|
| 0120 | The Manufacturing Output Path and Its Target Form | 0005 + 0018 + 0034 | merged: the path, the zero-dependency rule, and the target form are one decision about what leaves the tool |
| 0121 | JLC Prototype Delivery (BOM / Coordinates / Part Number) | 0006 | unchanged |
| 0122 | The Output Package Carries Its Own Provenance | new | placeholder: a package must state which source and which tool version produced it (invariant 11) — currently spread across `spec/pcb.md` §8 and the exporters |

### `devices/`

| New | Title | From | Note |
|---|---|---|---|
| 0123 | The Device Kind Is `part` or `generic`, and Devices Live in One Directory | 0027 + 0037 | merged: the split into parts and families, and the two-kind vocabulary, are one vocabulary decision |
| 0124 | The Device Vocabulary Is Closed and Checked; a Parameter Is a Role and a Quantity | 0038 | unchanged |
| 0125 | A Part States Its Own Ratings, and They Are Checked Against Declared Windows | 0039 + 0043 + 0044 + 0052 | merged: the rating vocabulary, the comparison against windows, dissipation, and the terminal naming are one decision about ratings |
| 0126 | The Package Gives a Chip Resistor Its Floor | 0045 | unchanged |
| 0127 | The Package Code Lives in the Footprint; 3D Models Belong to Parts | 0029 | unchanged |
| 0128 | The Procurement Layer — Which Part to Buy Is a Project-Local Decision | 0030 | absorbs the BOM-counting rule from `0002` |

### `libraries/`

| New | Title | From | Note |
|---|---|---|---|
| 0129 | Footprint Geometry and 3D Models Do Not Enter the Language; Our Own Footprint Format Is the Source | 0010 + 0011 | merged: what geometry is allowed in the language and the format that carries it are one decision about footprint files |
| 0130 | Self-Built Symbol Libraries Use Our Own Format | 0012 | unchanged |
| 0131 | The Reference Project Is Entirely Self-Built | 0013 | unchanged |
| 0132 | Libraries Are Unverified Facts; Provenance, Disclaimers, and Derived Overrides | 0028 | unchanged |
| 0133 | Trust in a Library You Do Not Own | 0047 + 0048 + 0049 | merged: template-not-dependency, the consumer's trust record, and the per-file revision are one trust model; absorbs `0046` |

### `view/`

| New | Title | From | Note |
|---|---|---|---|
| 0134 | The View Layer Is an Independent Description, and the View Is a Drawing, Not a Build Input | 0021 + 0032 | merged: the description type and the rule that it never becomes a build input are one decision |
| 0135 | Our Own Reference Renderer — IR → Drawing Commands → SVG | 0014 | unchanged |
| 0136 | Review Is Not a Description Type — Notes, Decisions, and the One Accountable Person | 0033 | unchanged |

### `process/`

| New | Title | From | Note |
|---|---|---|---|
| 0137 | Implementation Stack and the Agent's Entry Point | 0009 + 0019 | merged: the stack and the contract reference an agent reads are one decision about how agents work with the tool |
| 0138 | Licensing and Openness Policy | 0015 | unchanged |
| 0139 | Process Entities Stay Outside the Language | 0036 | unchanged |
| 0140 | Documentation Has One Authority per Fact, and the Rest Is a Pointer | 0055 | unchanged |

## 9. What the change costs the link gate

The gate is a shared asset: its semantic changes are reviewed line by line, and the corpus must not
land while the gate cannot see it. The change list is small, because the gate already resolves
paths relative to `docs/adr/`:

| Rule | Today | Needed |
|---|---|---|
| Record discovery | `scanAdrFiles` reads `docs/adr/` non-recursively and maps number → file name | read recursively; map number → path relative to `docs/adr/` (e.g. `language/0100-x.md`) |
| Link target check | compares the resolved link target against `join(docs/adr, <file name>)` | unchanged in shape — the stored value becomes a relative path |
| Index rows | four columns: link, title, status, date | unchanged — the folder is the section, not a column |
| Index ↔ disk | every record on disk is listed exactly once | unchanged in shape — compare against the relative path |
| Retired records | `Status:` names the superseding record; no body after it | unchanged |
| Addendum headings | dated | the addendum mechanism is retired for live records; the rule can stay as a no-op or be removed |
| New rule | — | every record has exactly one `Scope:` line, and it is not empty |
| New rule (R5) | — | a number is never reused: no record and no reserved number may fall inside a range the index declares as retired |

The test file `scripts/check-links.test.ts` gains positive and negative cases: a record in a
subdirectory resolves; a link to the right number but the wrong directory fails; an index row
without a folder segment fails; a retired record naming a record that does not exist fails; a
record carrying a number inside a retired range fails; a record outside it passes.

## 10. How the swap was carried out

The corpus swap went in as one commit, because the tree must never contain a state the gate
rejects:

1. The gate learned the new layout first, and stayed green on the old corpus.
2. The 41 records were written, with the dated corrections folded into the bodies and a `Scope:`
   on each.
3. The 56 old files were deleted, and the index and the 10 folder READMEs written.
4. Every citation and link target in the repository was rewritten by script, from a mapping table.
5. The prose that describes the corpus's own shape was updated (`AGENTS.md` §12, the guides, the
   READMEs).

The proof of completeness was mechanical: every old number appears in the mapping exactly once,
every old number is absent from the tree afterwards, and the link gate reports zero errors.

### 10.1 Adding a record afterwards

The rule that makes this cheap: **a new record takes the next free number and disturbs nothing.**

1. Take the next free number (the highest one in use, plus one) and write
   `docs/adr/<topic>/NNNN-<slug>.md`. The number does not encode the topic, so the folder is
   chosen freely.
2. Give it a `Scope:` line, a `Related:` line — symmetric, so add the new number to every record
   it names and to the ones that name it — and a `Date:`.
3. Add the index row under the record's folder section.
4. If the record retires another, name the superseding record in the retired one's `Status:`.

No other number moves, so no citation anywhere in the repository has to change. If the record
belongs in a folder that does not exist yet, create the folder with its `README.md`; the numbering
is unaffected.

## 11. The open questions, and how the corpus answers them

1. **Numbering blocks.** One flat counter, no per-folder blocks — see §4. A per-folder block ties a
   record's identity to its folder, so re-filing would force a renumbering that breaks prose
   citations in code and in the published contract.
2. **A record with no predecessor.** `0122` is one: it states provenance on the output package,
   which lived in a spec and in the exporters but in no record. The corpus holds it. A record's
   predecessor is a convenience of the swap, not a requirement — a decision that was never written
   down is exactly the kind of fact a corpus exists to fix.
3. **Scope shape.** The `Decides:` / `Does not decide:` pair was folded into `Scope:` as one
   sentence carrying both halves, so a record has one header line for it and the gate can check
   that both halves are present. The gate checks presence, never quality; that limit is accepted.
4. **Retiring the retired.** `0007` and `0046` were dropped rather than kept as retired stubs,
   because each was already superseded by a record that survives (`0111` and `0133`). The
   retired-stub mechanism stays, for a record that has to be retired from now on.
5. **Adding a new folder.** Creating a folder is not a claim about the project, so it takes no
   record: the folder is created with its `README.md` when a topic has no home, and §10.1's
   numbering rule is unaffected. A change that alters what a record *claims* is a different
   question, and that one takes a record.
