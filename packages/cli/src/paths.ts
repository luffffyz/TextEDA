// The project tree, organised by ownership rather than by asset kind (ADR-0008):
//
//   assets/    what this project owns: device assets + procurement decisions
//   external/  what this project references but does not own
//   design/    the circuit — the truth
//   views/     the drawings: hand-written, discardable, outside the build (ADR-0035)
//   docs/      design intent, review records, analysis evidence
//   dist/      derived artifacts
//
// The shard tree is independent of this one: shards are laid out by kind
// (`boards/`, `symbols/`, `footprints/`, ...), so moving a source file does not move its shard.
export const LAYOUT = {
  /** Device descriptions: one per file, the id taken from the file name (ADR-0024, ADR-0024). */
  components: "assets/components",
  /** Symbol libraries, one directory per library. */
  symbols: "assets/symbols",
  /** Footprint libraries, one directory per library. */
  footprints: "assets/footprints",
  /** Procurement selections (ADR-0029): `primary/` is normative, `alternatives/` is advisory. */
  procurement: "assets/procurement",
  /** Board schematics: `design/sch/<board_id>.teda`. */
  sch: "design/sch",
  /** Board layouts: `design/pcb/<board_id>.teda`. */
  pcb: "design/pcb",
  /** Review rounds (ADR-0037): `docs/reviews/<round_id>.md` and `<round_id>.decision.toml`. */
  reviews: "docs/reviews",
  /** Module definitions: `design/modules/<module_id>.teda`. */
  modules: "design/modules",
  /** System descriptions: `design/system/<system_id>.teda`. */
  system: "design/system",
  /** Print pages: `views/<board_id>/<page_id>.view.teda` (ADR-0035). */
  views: "views",
} as const;
