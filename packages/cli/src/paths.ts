// The project tree, organised by ownership rather than by asset kind (ADR-0008):
//
//   assets/    what this project owns: device assets + procurement decisions
//   external/  what this project references but does not own
//   design/    the circuit — the truth
//   views/     the drawings: hand-written, discardable, outside the build (ADR-0035, ADR-0068)
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
  /** The one logical root: `design/sch/main.teda` (ADR-0069 D1). */
  sch: "design/sch",
  /** Physical PCB implementations: `design/pcb/<pcb_id>.teda` (ADR-0069 D2). */
  pcb: "design/pcb",
  /** Review rounds (ADR-0037): `docs/reviews/<round_id>.md` and `<round_id>.decision.toml`. */
  reviews: "docs/reviews",
  /** Module definitions: `design/sch/modules/<module_id>.teda` (ADR-0070). */
  modules: "design/sch/modules",
  /** Project print pages: `views/<page_id>.view.teda` (ADR-0069 D4). */
  views: "views",
  /** Reusable module drawings: `views/modules/<module_id>.module-view.teda` (ADR-0068 D1). */
  moduleViews: "views/modules",
  /** Reusable sheet templates: `views/templates/<template_id>.sheet-template.teda` (ADR-0068 D1). */
  sheetTemplates: "views/templates",
} as const;

/** The logical root's fixed id (ADR-0069 D1): the only schematic is `design/sch/main.teda`. */
export const MAIN_SCHEMATIC_ID = "main";

/**
 * The file-name suffixes that mark the three view artifact kinds (ADR-0035, ADR-0068 D1).
 *
 * The suffix is the type marker: it says which description a file holds before anybody reads the
 * header, so one directory never yields another kind's rows.
 */
export const VIEW_SUFFIXES = {
  /** A project print page: `views/<page_id>.view.teda` (ADR-0069 D4). */
  page: ".view.teda",
  /** A reusable module drawing: `views/modules/<module_id>.module-view.teda`. */
  moduleView: ".module-view.teda",
  /** A reusable sheet template: `views/templates/<template_id>.sheet-template.teda`. */
  sheetTemplate: ".sheet-template.teda",
} as const;
