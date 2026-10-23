// `schematic` description parsing: source text → board-level IR (teda.md §7, ADR-0025).
//
// One board = one file: `sch/<board_id>.teda` holds the board's instances, nets, ports and constraints.
// There is no page level, no second namespace and no flattening (ADR-0025 decision 1-3).
//
// The parser never touches the filesystem: component contents are supplied by the caller (`ComponentResolver`),
// so the `parser` package still runs in the browser (ADR-0009 decision 1).
import { irVersion } from "@texteda/ir";
import type { ComponentParamDecl } from "./component.ts";
import type {
  Bus,
  Constraint,
  Instance,
  Net,
  NetOrPinRef,
  ParamValue,
  Port,
  Schematic,
} from "@texteda/ir/schematic";
import { checkConnectivity, type ConnectivityPin } from "@texteda/core";
import type { Diagnostic, DiagnosticCodeId } from "@texteda/ir/diagnostics";
import { lex, type Cell, type Line } from "./lexer.ts";
import { resolveParamColumns } from "./params.ts";
import { checkVersion, typeRange, type VersionRange } from "./version.ts";
import { byteCompare, naturalCompare, pinRefCompare } from "@texteda/ir/order";
import { parseQuantity, parseQuantityRange } from "./quantities.ts";
import { parseLengthNm } from "./units.ts";

/** The `schematic` type exists since 0.1; the `module` type since 0.8 (teda.md §13). */
const VERSION_RANGE: Record<DocumentKind, VersionRange> = {
  schematic: typeRange("schematic"),
  module: typeRange("module"),
};

const REFDES_RE = /^[A-Z]+[0-9]+$/;
const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const NET_ID_RE = /^[A-Za-z0-9_+-]+$/;
const PORT_ID_RE = /^[A-Za-z0-9_+-]+$/;
/** A module instance id: the `M` tag plus digits (ADR-0024, ADR-0026 decision 5). */
const MODULE_INSTANCE_RE = /^M[0-9]+$/;
/** The value a module's `ports` row uses for a port that is intentionally not connected. */
const NO_CONNECT = "no_connect";

/**
 * The first-column marker of a continuation row: a bare `:` adds members to the net named by the row above.
 * The marker is explicit rather than inferred from indentation, because indentation carries no meaning in `.teda` (teda.md §3).
 */
const CONTINUATION = ":";

/** Component pin facts (from a `component`'s `pins` section). */
export interface ComponentPinFactLite {
  number: string;
  name: string;
  type: string;
  unit: number;
}

/** Component information needed to parse a schematic. */
export interface ComponentFactsLite {
  params: ComponentParamDecl[];
  pins: ComponentPinFactLite[];
}

/** Component resolver: caller supplies id → facts; returns undefined when not found. */
export interface ComponentResolver {
  resolve(componentId: string): ComponentFactsLite | undefined;
  /**
   * The device file of an id that exists but has errors, as a path relative to the project root.
   *
   * A broken file yields no facts, so a board referencing it would otherwise report "component
   * not found" — which is false: the file is there, it is wrong. The caller says which files are
   * broken so the diagnostic can point at the real cause.
   */
  broken?(componentId: string): string | undefined;
}

/**
 * Report a reference to a component that yields no facts.
 *
 * Two cases, two codes: the device file is missing (`ref.unknown-component`), or it exists and has
 * errors (`ref.component-invalid`). Saying "not found" about a file that is there sends the
 * reader looking in the wrong place — and repeats the same lie once per reference.
 */
function reportUnusableComponent(
  diagnostics: Diagnostics,
  resolver: ComponentResolver | undefined,
  componentId: string,
  refdes: string,
  file: string,
  line: number,
  col: number,
  extra?: { module_instance_id?: string },
): void {
  const brokenFile = resolver?.broken?.(componentId);
  if (brokenFile !== undefined) {
    // The device file's own errors are reported separately and already block the check; this
    // reference is a consequence, so it points at the cause instead of repeating it as an error.
    diagnostics.add(
      "warning",
      "ref.component-invalid",
      `component ${componentId} has errors in ${brokenFile}`,
      file,
      line,
      col,
      {
        expected: "a device file without errors",
        hint: `fix the errors reported for ${brokenFile} first`,
        data: {
          component_id: componentId,
          refdes,
          device_file: brokenFile,
          ...(extra?.module_instance_id !== undefined ? { module_instance_id: extra.module_instance_id } : {}),
        },
      },
    );
    return;
  }
  diagnostics.add(
    "error",
    "ref.unknown-component",
    `component ${componentId} not found`,
    file,
    line,
    col,
    {
      expected: `components/ contains ${componentId}.teda`,
      data: {
        component_id: componentId,
        refdes,
        ...(extra?.module_instance_id !== undefined ? { module_instance_id: extra.module_instance_id } : {}),
      },
    },
  );
}

export interface SchematicParseOptions {
  /** Board file (relative to the project root), written into the IR's `source.file`. */
  file: string;
  /** board_id. */
  board: string;
  /** Component resolver; if omitted, every `instances` row reports "component not found". */
  components?: ComponentResolver;
  /** The module files the board's `modules` section may reference (ADR-0026). */
  modules?: ModuleSource[];
}

export interface SchematicParseResult {
  ok: boolean;
  ir?: Schematic;
  diagnostics: Diagnostic[];
}

/* ------------------------------------------------------------------ document model */

interface RawInstance {
  refdes: string;
  componentId: string;
  paramCells: string[];
  line: number;
  col: number;
}

interface RawNet {
  name: string;
  memberRefs: string[];
  line: number;
}

interface RawPort {
  id: string;
  net: string;
  line: number;
  col: number;
}

interface RawConstraint {
  type: string;
  args: string[];
  line: number;
  col: number;
}

interface RawBusMember {
  member: string;
  refs: string[];
  line: number;
}

interface RawBus {
  id: string;
  type: string;
  members: RawBusMember[];
  line: number;
}

/** One row of the board's `modules` section: a module instance and the module it instantiates. */
interface RawModule {
  /** Module instance id (`M1`). */
  instanceId: string;
  /** Module definition id (`buck-5v`): the file name without `.teda`. */
  moduleId: string;
  line: number;
  col: number;
}

/** The document type of a board or module file. */
export type DocumentKind = "schematic" | "module";

/** A module file the board's `modules` section may reference (the parser never touches the disk). */
export interface ModuleSource {
  /** Module id: the file name without `.teda`. */
  moduleId: string;
  /** Path relative to the project root. */
  file: string;
  /** The module file's text. */
  text: string;
}

export interface Document {
  id: string;
  version: string;
  file: string;
  instances: RawInstance[];
  nets: RawNet[];
  ports: RawPort[];
  constraints: RawConstraint[];
  buses: RawBus[];
  modules: RawModule[];
}

export interface DocumentParseOptions {
  file: string;
  /** Which description type the file holds. Defaults to `schematic`. */
  kind?: DocumentKind;
}

export interface DocumentParseResult {
  ok: boolean;
  doc?: Document;
  diagnostics: Diagnostic[];
}

/** Diagnostic collector: locations always include line and column. */
class Diagnostics {
  readonly items: Diagnostic[] = [];

  add(
    severity: "error" | "warning",
    code: DiagnosticCodeId,
    message: string,
    file: string,
    line: number,
    col: number,
    extra?: {
      expected?: string;
      actual?: string;
      hint?: string;
      /** Machine-usable structured fields: field names are stable, agents branch on them (ADR-0016). */
      data?: Record<string, string | number | boolean>;
    },
  ): void {
    this.items.push({
      code,
      severity,
      message,
      location: { file, line, col },
      ...(extra?.expected !== undefined ? { expected: extra.expected } : {}),
      ...(extra?.actual !== undefined ? { actual: extra.actual } : {}),
      ...(extra?.hint !== undefined ? { hint: extra.hint } : {}),
      ...(extra?.data !== undefined ? { data: extra.data } : {}),
    });
  }

  get hasError(): boolean {
    return this.items.some((d) => d.severity === "error");
  }
}

/* ------------------------------------------------------------------ document parsing */

/** Section name → whether it is known (static table). */
const SECTION_NAMES: Record<string, true> = {
  instances: true,
  nets: true,
  ports: true,
  constraints: true,
};

/** Parse a single `schematic` or `module` document. */
export function parseSchematicDocument(text: string, options: DocumentParseOptions): DocumentParseResult {
  const { file } = options;
  const kind: DocumentKind = options.kind ?? "schematic";
  const diagnostics = new Diagnostics();
  const lines = lex(text).filter((l) => !l.blank && !l.comment);

  const versionLine = lines[0];
  if (!versionLine || versionLine.cells[0]?.text !== "version") {
    diagnostics.add("error", "syntax.header-invalid", "the first line must be version <ver>", file, 1, 1);
    return { ok: false, diagnostics: diagnostics.items };
  }
  const version = versionLine.cells[1]?.text ?? "";
  const verdict = checkVersion(version, VERSION_RANGE[kind], kind);
  if (!verdict.ok) {
    diagnostics.add(
      "error",
      verdict.code,
      verdict.message,
      file,
      versionLine.number,
      versionLine.cells[1]?.col ?? 1,
      verdict.hint ? { hint: verdict.hint } : undefined,
    );
    return { ok: false, diagnostics: diagnostics.items };
  }
  // The canonical spelling of the version: `0.3` and `0.3.0` are the same version, so the IR stores one of them.
  const versionText = verdict.text;

  const typeLine = lines[1];
  const expectedType = kind;
  if (!typeLine || typeLine.cells.length !== 2 || typeLine.cells[0]!.text !== expectedType) {
    // The `page` description type was removed in language 0.7 (ADR-0025): say so instead of "unknown type".
    if (typeLine?.cells[0]?.text === "page") {
      diagnostics.add(
        "error",
        "syntax.removed-construct",
        "the `page` description type was removed in language 0.7: a board has one schematic file",
        file,
        typeLine.number,
        typeLine.cells[0]!.col,
        {
          hint: "merge this file's instances, nets and constraints into sch/<board_id>.teda and delete the pages section; see teda.md §13.4 and docs/adr/0025-flat-board-and-print-pages.md",
        },
      );
    } else {
      diagnostics.add("error", "syntax.header-invalid", `the second line must be ${expectedType} <id>`, file, typeLine?.number ?? 2, 1);
    }
    return { ok: false, diagnostics: diagnostics.items };
  }
  const id = typeLine.cells[1]!.text;
  if (!SLUG_RE.test(id)) {
    diagnostics.add("error", "syntax.invalid-identifier", `invalid id: ${id}`, file, typeLine.number, typeLine.cells[1]!.col);
  }

  const doc: Document = {
    id,
    version: versionText,
    file,
    instances: [],
    nets: [],
    ports: [],
    constraints: [],
    buses: [],
    modules: [],
  };

  const netIndex = new Map<string, RawNet>();
  let section: string | null = null;
  let bus: RawBus | null = null;
  /** The net named by the most recent net row; a continuation row adds to this net. */
  let lastNetName: string | null = null;

  for (const line of lines.slice(2)) {
    const cells = line.cells;
    if (cells.length === 0) continue;
    const head = cells[0]!.text;

    if (head === "bus") {
      if (kind !== "schematic") {
        diagnostics.add("error", "syntax.unknown-section", "the bus section is not allowed in a module", file, line.number, cells[0]!.col);
        continue;
      }
      if (cells.length !== 4 || cells[2]!.text !== "=") {
        diagnostics.add("error", "syntax.row-too-short", "a bus row must be written as bus <id> = <type>", file, line.number, cells[0]!.col);
        continue;
      }
      bus = { id: cells[1]!.text, type: cells[3]!.text, members: [], line: line.number };
      doc.buses.push(bus);
      section = "bus";
      continue;
    }

    if (head === "pages") {
      // The `pages` section was removed in language 0.7 (ADR-0025): say so instead of "unknown section".
      diagnostics.add(
        "error",
        "syntax.removed-construct",
        "the `pages` section was removed in language 0.7: a board has one schematic file",
        file,
        line.number,
        cells[0]!.col,
        {
          hint: "merge the page files' instances, nets and constraints into this file and delete the pages section; see teda.md §13.4 and docs/adr/0025-flat-board-and-print-pages.md",
        },
      );
      continue;
    }

    if (head === "modules") {
      if (kind !== "schematic") {
        diagnostics.add("error", "syntax.unknown-section", "a module cannot contain modules: the hierarchy is one level deep", file, line.number, cells[0]!.col);
        continue;
      }
      section = "modules";
      bus = null;
      lastNetName = null;
      continue;
    }

    if (SECTION_NAMES[head] === true) {
      section = head;
      bus = null;
      lastNetName = null;
      continue;
    }

    if (section === null) {
      diagnostics.add("error", "syntax.unknown-section", `unknown section: ${head}`, file, line.number, cells[0]!.col);
      continue;
    }

    switch (section) {
      case "instances": {
        if (cells.length < 2) {
          diagnostics.add("error", "syntax.row-too-short", "an instances row needs at least 2 columns: refdes component_id", file, line.number, cells[0]!.col);
          continue;
        }
        const refdes = cells[0]!.text;
        const componentId = cells[1]!.text;
        if (!REFDES_RE.test(refdes)) {
          diagnostics.add("error", "syntax.invalid-identifier", `invalid refdes: ${refdes}`, file, line.number, cells[0]!.col);
        } else if (kind === "schematic" && MODULE_INSTANCE_RE.test(refdes)) {
          // The M-plus-digits form belongs to module instance ids, so that `M2.VOUT` in a net row
          // can only mean "module M2's port VOUT" (ADR-0026 decision 5).
          diagnostics.add(
            "error",
            "syntax.invalid-identifier",
            `invalid refdes: ${refdes} (the M plus digits form is reserved for module instance ids)`,
            file,
            line.number,
            cells[0]!.col,
          );
        }
        if (!SLUG_RE.test(componentId)) {
          diagnostics.add("error", "syntax.invalid-identifier", `invalid component_id: ${componentId}`, file, line.number, cells[1]!.col);
        }
        doc.instances.push({
          refdes,
          componentId,
          paramCells: cells.slice(2).map((c) => c.text),
          line: line.number,
          col: cells[0]!.col,
        });
        continue;
      }
      case "nets": {
        const { name, members } = splitNetRow(cells);
        if (name === "") {
          diagnostics.add("error", "syntax.row-too-short", "a nets row needs at least a net name", file, line.number, cells[0]!.col);
          continue;
        }
        // A continuation row starts with a bare colon: it adds members to the net named by the row above.
        if (name === CONTINUATION) {
          const target = lastNetName === null ? undefined : netIndex.get(lastNetName);
          if (target === undefined) {
            diagnostics.add(
              "error",
              "net.continuation-without-net",
              "a continuation row (a bare `:` in the first column) must follow a net row",
              file,
              line.number,
              cells[0]!.col,
            );
            continue;
          }
          for (const ref of members) {
            if (target.memberRefs.includes(ref)) {
              diagnostics.add("error", "net.duplicate-member", `pin ${ref} appears more than once in net ${target.name}`, file, line.number, cells[0]!.col);
              continue;
            }
            target.memberRefs.push(ref);
          }
          continue;
        }
        if (!NET_ID_RE.test(name)) {
          // Net names are board-level and must not contain a dot (the qualified form is reserved for the module hierarchy; teda.md §7.6).
          diagnostics.add(
            "error",
            "syntax.invalid-identifier",
            `invalid net name: ${name} (only letters, digits, _, +, - are allowed)`,
            file,
            line.number,
            cells[0]!.col,
          );
          continue;
        }
        if (kind === "module" && name === NO_CONNECT) {
          // `no_connect` marks a port that is intentionally not connected; it cannot be a net name.
          diagnostics.add(
            "error",
            "syntax.invalid-identifier",
            `invalid net name: ${name} (this name is reserved for the no_connect port marker)`,
            file,
            line.number,
            cells[0]!.col,
          );
          continue;
        }
        const existing = netIndex.get(name);
        if (existing) {
          for (const ref of members) {
            if (existing.memberRefs.includes(ref)) {
              diagnostics.add("error", "net.duplicate-member", `pin ${ref} appears more than once in net ${name}`, file, line.number, cells[0]!.col);
              continue;
            }
            existing.memberRefs.push(ref);
          }
          lastNetName = name;
          continue;
        }
        const net: RawNet = { name, memberRefs: members, line: line.number };
        netIndex.set(name, net);
        doc.nets.push(net);
        lastNetName = name;
        continue;
      }
      case "ports": {
        if (cells.length !== 2) {
          diagnostics.add("error", "syntax.row-too-short", "a ports row must be written as port_id net", file, line.number, cells[0]!.col);
          continue;
        }
        const portId = cells[0]!.text;
        if (!PORT_ID_RE.test(portId)) {
          diagnostics.add("error", "syntax.invalid-identifier", `invalid port_id: ${portId}`, file, line.number, cells[0]!.col);
        }
        if (doc.ports.some((p) => p.id === portId)) {
          diagnostics.add("error", "value.duplicate-field", `duplicate port_id: ${portId}`, file, line.number, cells[0]!.col);
          continue;
        }
        const portNet = cells[1]!.text;
        if (portNet === NO_CONNECT) {
          // A module may declare a port it intentionally does not connect (spec/module.md §3).
          if (kind !== "module") {
            diagnostics.add(
              "error",
              "syntax.invalid-identifier",
              `a board port cannot be ${NO_CONNECT}: the board's ports are its external interface`,
              file,
              line.number,
              cells[1]!.col,
            );
            continue;
          }
        }
        doc.ports.push({ id: portId, net: portNet, line: line.number, col: cells[0]!.col });
        continue;
      }
      case "modules": {
        if (cells.length !== 2) {
          diagnostics.add("error", "syntax.row-too-short", "a modules row needs exactly 2 columns: module_instance_id module_id", file, line.number, cells[0]!.col);
          continue;
        }
        const instanceId = cells[0]!.text;
        const moduleId = cells[1]!.text;
        if (!MODULE_INSTANCE_RE.test(instanceId)) {
          diagnostics.add(
            "error",
            "syntax.invalid-identifier",
            `invalid module_instance_id: ${instanceId} (a module instance id is M plus digits)`,
            file,
            line.number,
            cells[0]!.col,
          );
          continue;
        }
        if (!SLUG_RE.test(moduleId)) {
          diagnostics.add("error", "syntax.invalid-identifier", `invalid module_id: ${moduleId}`, file, line.number, cells[1]!.col);
          continue;
        }
        doc.modules.push({ instanceId, moduleId, line: line.number, col: cells[0]!.col });
        continue;
      }
      case "constraints": {
        doc.constraints.push({
          type: cells[0]!.text,
          args: cells.slice(1).map((c) => c.text),
          line: line.number,
          col: cells[0]!.col,
        });
        continue;
      }
      case "bus": {
        if (!bus) continue;
        const { name, members } = splitNetRow(cells);
        if (name === "") {
          diagnostics.add("error", "syntax.row-too-short", "a bus member row needs at least a member name", file, line.number, cells[0]!.col);
          continue;
        }
        if (name === CONTINUATION) {
          const target = bus.members[bus.members.length - 1];
          if (target === undefined) {
            diagnostics.add(
              "error",
              "net.continuation-without-net",
              "a continuation row (a bare `:` in the first column) must follow a bus member row",
              file,
              line.number,
              cells[0]!.col,
            );
            continue;
          }
          target.refs.push(...members);
          continue;
        }
        bus.members.push({ member: name, refs: members, line: line.number });
        continue;
      }
      default:
        continue;
    }
  }

  // The net referenced by a port must exist (a port does not create a node).
  for (const port of doc.ports) {
    if (port.net === NO_CONNECT) continue; // a module port that is intentionally not connected
    if (!netIndex.has(port.net)) {
      diagnostics.add(
        "error",
        "ref.unknown-net",
        `net ${port.net} referenced by port ${port.id} does not exist in this file`,
        file,
        port.line,
        port.col,
        { hint: "declare this net in the nets section first" },
      );
    }
  }

  if (kind === "module") {
    // A module's net is reachable through at most one port (spec/module.md §3).
    const portOwners = new Map<string, string>();
    for (const port of doc.ports) {
      if (port.net === NO_CONNECT) continue;
      const owner = portOwners.get(port.net);
      if (owner !== undefined) {
        diagnostics.add(
          "error",
          "ref.duplicate-port-net",
          `net ${port.net} is referenced by both port ${owner} and port ${port.id}`,
          file,
          port.line,
          port.col,
          { hint: "at most one port per net; to break out in multiple places, use a different net" },
        );
        continue;
      }
      portOwners.set(port.net, port.id);
    }
  }

  return { ok: !diagnostics.hasError, doc, diagnostics: diagnostics.items };
}

/**
 * A `nets` row: the first cell is the net name (may carry a trailing `:`); a standalone `:` cell is also accepted.
 *
 * A row whose first cell is a bare `:` is a continuation row: it adds members to the net named by the row above.
 * The marker is explicit, so indentation never carries meaning (teda.md §7.2).
 */
function splitNetRow(cells: Cell[]): { name: string; members: string[] } {
  if (cells.length === 0) return { name: "", members: [] };
  const first = cells[0]!.text;
  if (first === CONTINUATION) {
    return { name: CONTINUATION, members: cells.slice(1).map((c) => c.text) };
  }
  if (first.endsWith(":")) {
    return { name: first.slice(0, -1), members: cells.slice(1).map((c) => c.text) };
  }
  if (cells[1]?.text === ":") {
    return { name: first, members: cells.slice(2).map((c) => c.text) };
  }
  return { name: first, members: cells.slice(1).map((c) => c.text) };
}

/* ------------------------------------------------------------------ board assembly */

/** Scope: the instances, nets and ports of one board. */
interface Scope {
  /** refdes → instance. */
  instances: Map<string, RawInstance>;
  /** net name → net. */
  nets: Map<string, RawNet>;
  /** port_id → net name. */
  ports: Map<string, string>;
  doc: Document;
}

/** One module instance of the board: its local scope, plus the id it is known by in the board. */
interface ModuleScope {
  /** Module instance id (`M1`). */
  instanceId: string;
  /** Module definition id (`buck-5v`). */
  moduleId: string;
  /** The module's own instances, nets and ports. */
  scope: Scope;
  /** The module file, for diagnostics. */
  file: string;
}

export function parseSchematic(text: string, options: SchematicParseOptions): SchematicParseResult {
  const diagnostics = new Diagnostics();
  const board = parseSchematicDocument(text, { file: options.file });
  for (const d of board.diagnostics) diagnostics.items.push(d);
  if (!board.doc) return { ok: false, diagnostics: diagnostics.items };

  const boardDoc = board.doc;
  const resolver = options.components;

  const scope: Scope = {
    instances: new Map(),
    nets: new Map(boardDoc.nets.map((n) => [n.name, n])),
    ports: new Map(boardDoc.ports.map((p) => [p.id, p.net])),
    doc: boardDoc,
  };
  for (const inst of boardDoc.instances) {
    if (scope.instances.has(inst.refdes)) {
      diagnostics.add("error", "ref.duplicate-refdes", `duplicate refdes: ${inst.refdes}`, boardDoc.file, inst.line, inst.col);
      continue;
    }
    scope.instances.set(inst.refdes, inst);
  }

  /* -------- module scopes -------- */

  // A board composes modules (ADR-0026): each module instance brings its own instances, nets and
  // ports. The board reaches a module only through its ports.
  const moduleSources = new Map<string, ModuleSource>();
  for (const source of options.modules ?? []) moduleSources.set(source.moduleId, source);

  const moduleScopes: ModuleScope[] = [];
  const moduleInstanceIds = new Set<string>();
  for (const row of boardDoc.modules) {
    if (moduleInstanceIds.has(row.instanceId)) {
      diagnostics.add(
        "error",
        "value.duplicate-field",
        `duplicate module_instance_id: ${row.instanceId}`,
        boardDoc.file,
        row.line,
        row.col,
      );
      continue;
    }
    if (scope.instances.has(row.instanceId)) {
      diagnostics.add(
        "error",
        "ref.duplicate-refdes",
        `module_instance_id ${row.instanceId} has the same name as a board-level refdes`,
        boardDoc.file,
        row.line,
        row.col,
      );
      continue;
    }
    moduleInstanceIds.add(row.instanceId);

    const source = moduleSources.get(row.moduleId);
    if (!source) {
      diagnostics.add(
        "error",
        "ref.unknown-module",
        `module ${row.moduleId} has no corresponding source file`,
        boardDoc.file,
        row.line,
        row.col,
        { expected: `modules/${row.moduleId}.teda`, data: { module_id: row.moduleId } },
      );
      continue;
    }
    const parsed = parseSchematicDocument(source.text, { file: source.file, kind: "module" });
    for (const d of parsed.diagnostics) diagnostics.items.push(d);
    if (!parsed.doc) continue;
    if (parsed.doc.id !== source.moduleId) {
      diagnostics.add(
        "error",
        "ref.module-id-mismatch",
        `the id declared in the module file header is ${parsed.doc.id}, the file name is ${source.moduleId}`,
        source.file,
        2,
        1,
        { data: { declared_id: parsed.doc.id, file_id: source.moduleId } },
      );
      continue;
    }
    const moduleScope: Scope = {
      instances: new Map(),
      nets: new Map(parsed.doc.nets.map((n) => [n.name, n])),
      ports: new Map(parsed.doc.ports.map((p) => [p.id, p.net])),
      doc: parsed.doc,
    };
    for (const inst of parsed.doc.instances) {
      if (moduleScope.instances.has(inst.refdes)) {
        diagnostics.add(
          "error",
          "ref.duplicate-refdes",
          `duplicate refdes: ${inst.refdes}`,
          source.file,
          inst.line,
          inst.col,
        );
        continue;
      }
      moduleScope.instances.set(inst.refdes, inst);
    }
    moduleScopes.push({ instanceId: row.instanceId, moduleId: row.moduleId, scope: moduleScope, file: source.file });
  }

  /* -------- instances -------- */

  const instances: Instance[] = [];
  const instanceOrigin = new Map<string, { file: string; line: number; col: number }>();
  for (const inst of scope.instances.values()) {
    const facts = resolver?.resolve(inst.componentId);
    if (!facts) {
      reportUnusableComponent(diagnostics, resolver, inst.componentId, inst.refdes, boardDoc.file, inst.line, inst.col);
      continue;
    }
    const params = resolveParams(inst, facts, boardDoc.file, diagnostics);
    instanceOrigin.set(inst.refdes, { file: boardDoc.file, line: inst.line, col: inst.col });
    instances.push({
      id: inst.refdes,
      component: inst.componentId,
      ...(params.length > 0 ? { params } : {}),
      line: inst.line,
    });
  }
  for (const module of moduleScopes) {
    for (const inst of module.scope.instances.values()) {
      const id = `${module.instanceId}.${inst.refdes}`;
      const facts = resolver?.resolve(inst.componentId);
      if (!facts) {
        reportUnusableComponent(diagnostics, resolver, inst.componentId, inst.refdes, module.file, inst.line, inst.col, {
          module_instance_id: module.instanceId,
        });
        continue;
      }
      const params = resolveParams(inst, facts, module.file, diagnostics);
      instanceOrigin.set(id, { file: module.file, line: inst.line, col: inst.col });
      instances.push({
        id,
        component: inst.componentId,
        ...(params.length > 0 ? { params } : {}),
        line: inst.line,
      });
    }
  }

  /* -------- nets -------- */

  const nets: Net[] = [];
  const netOrigin = new Map<string, { file: string; line: number }>(); // net → declaration location

  // A module's own nets, flattened to `M1.NET` with the members `M1.R1.2`. A net that a port merges
  // into a board-level net disappears: the board-level net takes its name and its members.
  const moduleNets = new Map<string, { id: string; members: string[]; line: number; file: string }>();
  for (const module of moduleScopes) {
    for (const [name, raw] of module.scope.nets) {
      const members: string[] = [];
      for (const ref of raw.memberRefs) {
        const resolved = resolvePinRef(module.scope, ref, resolver, diagnostics, "this module");
        if (resolved !== null) members.push(`${module.instanceId}.${resolved}`);
      }
      moduleNets.set(`${module.instanceId}.${name}`, {
        id: `${module.instanceId}.${name}`,
        members,
        line: raw.line,
        file: module.file,
      });
    }
  }

  /** Module instance id → port id → the board-level net the port is bound to. */
  const portBinding = new Map<string, Map<string, string>>();
  /** A module net that a port merged into a board-level net: `M1.NET` → the board net's name. */
  const mergedInto = new Map<string, string>();

  for (const net of boardDoc.nets) {
    const members: string[] = [];
    for (const ref of net.memberRefs) {
      const parts = ref.split(".");
      const target = parts.length === 2 ? moduleScopes.find((m) => m.instanceId === parts[0]) : undefined;
      if (target) {
        // A module port reference: the module's internal net merges into this board-level net.
        const portId = parts[1]!;
        const internalNet = target.scope.ports.get(portId);
        if (internalNet === undefined) {
          diagnostics.add(
            "error",
            "ref.unknown-port",
            `module ${target.instanceId} does not declare port ${portId}`,
            boardDoc.file,
            net.line,
            1,
            { data: { module_instance_id: target.instanceId, port_id: portId } },
          );
          continue;
        }
        if (internalNet === NO_CONNECT) {
          diagnostics.add(
            "error",
            "ref.no-connect-port",
            `port ${target.instanceId}.${portId} is declared no_connect and cannot join a net`,
            boardDoc.file,
            net.line,
            1,
            { data: { module_instance_id: target.instanceId, port_id: portId } },
          );
          continue;
        }
        const bound = portBinding.get(target.instanceId) ?? new Map<string, string>();
        const owner = bound.get(portId);
        if (owner !== undefined) {
          diagnostics.add(
            "error",
            "net.port-in-two-nets",
            `port ${target.instanceId}.${portId} is referenced by both net ${owner} and net ${net.name}`,
            boardDoc.file,
            net.line,
            1,
            { data: { module_instance_id: target.instanceId, port_id: portId, net: net.name } },
          );
          continue;
        }
        bound.set(portId, net.name);
        portBinding.set(target.instanceId, bound);

        const key = `${target.instanceId}.${internalNet}`;
        const moduleNet = moduleNets.get(key);
        if (moduleNet) {
          for (const member of moduleNet.members) members.push(member);
          mergedInto.set(key, net.name);
          moduleNets.delete(key);
        }
        continue;
      }
      if (parts.length >= 3 && moduleInstanceIds.has(parts[0]!)) {
        // The board reaches a module through its ports, not through its internals.
        diagnostics.add(
          "error",
          "ref.module-internal-ref",
          `net ${net.name} references ${ref}, which is inside module ${parts[0]}`,
          boardDoc.file,
          net.line,
          1,
          {
            hint: "reference the module's port instead; a module's internals are reached through its ports",
            data: { module_instance_id: parts[0]! },
          },
        );
        continue;
      }
      const resolved = resolvePinRef(scope, ref, resolver, diagnostics);
      if (resolved !== null) members.push(resolved);
    }
    nets.push({ id: net.name, members });
    netOrigin.set(net.name, { file: boardDoc.file, line: net.line });
  }

  // The module nets that no port merged into a board-level net keep their qualified name.
  for (const moduleNet of moduleNets.values()) {
    nets.push({ id: moduleNet.id, members: moduleNet.members });
    netOrigin.set(moduleNet.id, { file: moduleNet.file, line: moduleNet.line });
  }

  // Every port must be bound by a board-level net, unless the module declares it as no_connect.
  for (const module of moduleScopes) {
    const bound = portBinding.get(module.instanceId) ?? new Map<string, string>();
    for (const [portId, internalNet] of module.scope.ports) {
      if (internalNet === NO_CONNECT) continue;
      if (!bound.has(portId)) {
        diagnostics.add(
          "error",
          "ref.unbound-port",
          `port ${module.instanceId}.${portId} is not connected to any board-level net`,
          module.file,
          1,
          1,
          {
            hint: "reference the port in a board-level net row, or declare it as no_connect",
            data: { module_instance_id: module.instanceId, port_id: portId },
          },
        );
      }
    }
  }

  /* -------- bus -------- */

  const buses: Bus[] = [];
  for (const bus of boardDoc.buses) {
    const busNets: string[] = [];
    for (const member of bus.members) {
      const netId = `${bus.id}.${member.member}`;
      const members: string[] = [];
      for (const ref of member.refs) {
        const resolved = resolvePinRef(scope, ref, resolver, diagnostics);
        if (resolved !== null) members.push(resolved);
      }
      nets.push({ id: netId, members });
      busNets.push(netId);
    }
    buses.push({ id: bus.id, type: bus.type, nets: busNets });
  }

  /* -------- canonical order -------- */

  // The IR depends on the semantics only: the order of rows and of members in the source must not leak into it.
  // Nets are ordered by id, and the members of a net by their resolved pin reference.
  for (const net of nets) net.members.sort(pinRefCompare);
  nets.sort((a, b) => byteCompare(a.id, b.id));

  // Connectivity rules live in `@texteda/core` (ADR-0019 / backlog F19): this file only lays out the facts—
  // the board's nets, each instance's pins, which nets carry board ports, and the locations.
  const pins: ConnectivityPin[] = [];
  for (const instance of instances) {
    const facts = resolver?.resolve(instance.component);
    if (!facts) continue;
    for (const pin of facts.pins) {
      pins.push({
        key: `${instance.id}.${pin.number}`,
        component: instance.component,
        name: pin.name,
        ...(pin.type === undefined ? {} : { type: pin.type }),
      });
    }
  }
  diagnostics.items.push(
    ...checkConnectivity({
      file: boardDoc.file,
      nets: nets.map((net) => ({ id: net.id, members: net.members })),
      portNets: new Set(boardDoc.ports.map((port) => port.net)),
      pins,
      locateNet: (id) => {
        const origin = netOrigin.get(id);
        return origin === undefined ? undefined : { file: origin.file, line: origin.line, col: 1 };
      },
      locateInstance: (id) => instanceOrigin.get(id),
    }),
  );

  /* -------- ports -------- */

  const ports: Port[] = [];
  // A single net is referenced by at most one port.
  const portNets = new Map<string, string>(); // net → port id
  for (const port of boardDoc.ports) {
    const owner = portNets.get(port.net);
    if (owner !== undefined) {
      diagnostics.add(
        "error",
        "ref.duplicate-port-net",
        `net ${port.net} is referenced by both port ${owner} and port ${port.id}`,
        boardDoc.file,
        port.line,
        port.col,
        { hint: "at most one port per net; to break out in multiple places, use a different net" },
      );
      continue;
    }
    portNets.set(port.net, port.id);
    ports.push({ id: port.id, net: port.net });
  }

  /* -------- constraints -------- */

  const constraints: Constraint[] = [];
  for (const raw of boardDoc.constraints) {
    const constraint = buildConstraint(raw, scope, resolver, diagnostics);
    if (constraint !== null) constraints.push(constraint);
  }
  for (const module of moduleScopes) {
    // A module's constraint names a module-local net or pin; the IR carries the flattened name.
    for (const raw of module.scope.doc.constraints) {
      const constraint = buildConstraint(raw, module.scope, resolver, diagnostics);
      if (constraint === null) continue;
      const flatten = (text: string): string => {
        if (module.scope.nets.has(text)) {
          const key = `${module.instanceId}.${text}`;
          return mergedInto.get(key) ?? key;
        }
        return `${module.instanceId}.${text}`;
      };
      constraints.push(flattenConstraint(constraint, flatten));
    }
  }

  /* -------- assembly -------- */

  instances.sort((a, b) => naturalCompare(a.id, b.id));
  nets.sort((a, b) => byteCompare(a.id, b.id));
  ports.sort((a, b) => byteCompare(a.id, b.id));

  const ir: Schematic = {
    ir_version: irVersion,
    format: boardDoc.version,
    source: { file: boardDoc.file, line: 1 },
    board: options.board,
    instances,
    nets,
    ...(ports.length > 0 ? { ports } : {}),
    ...(buses.length > 0 ? { buses } : {}),
    ...(constraints.length > 0 ? { constraints } : {}),
  };

  return { ok: !diagnostics.hasError, ir, diagnostics: diagnostics.items };
}

/* ------------------------------------------------------------------ value helpers */

/**
 * Map a module's constraint onto the flattened names: a module-local net becomes `M1.NET` (or the
 * board-level net it merged into), a module-local pin reference becomes `M1.U1.2`.
 */
function flattenConstraint(constraint: Constraint, flatten: (text: string) => string): Constraint {
  switch (constraint.type) {
    case "voltage":
    case "current":
    case "power":
      return { ...constraint, subject: flatten(constraint.subject) };
    case "impedance":
    case "length":
      return { ...constraint, net: flatten(constraint.net) };
    case "diff":
    case "skew":
      return { ...constraint, net_a: flatten(constraint.net_a), net_b: flatten(constraint.net_b) };
    default:
      return constraint;
  }
}

/** Parameter columns of an instance row → the IR's param_value list. */
function resolveParams(
  inst: RawInstance,
  facts: ComponentFactsLite,
  file: string,
  diagnostics: Diagnostics,
): ParamValue[] {
  return resolveParamColumns(facts.params, inst.paramCells, {
    deviceId: inst.componentId,
    label: "component",
    file,
    line: inst.line,
    col: inst.col,
  }, diagnostics);
}

/** Resolve a pin reference → `<instance_id>.<pin_number>`. */
function resolvePinRef(
  scope: Scope,
  ref: string,
  resolver: ComponentResolver | undefined,
  diagnostics: Diagnostics,
  /** How the file is called in diagnostics ("this board" / "this module"). */
  context = "this board",
): string | null {
  const parts = ref.split(".");
  if (parts.length < 2 || parts.length > 3) {
    diagnostics.add("error", "syntax.invalid-ref", `invalid pin reference: ${ref}`, scope.doc.file, 1, 1);
    return null;
  }
  const refdes = parts[0]!;
  const inst = scope.instances.get(refdes);
  if (!inst) {
    diagnostics.add(
      "error",
      "ref.unknown-instance",
      `instance ${refdes} does not exist in ${context}`,
      scope.doc.file,
      1,
      1,
    );
    return null;
  }
  const facts = resolver?.resolve(inst.componentId);
  if (!facts) {
    reportUnusableComponent(diagnostics, resolver, inst.componentId, inst.refdes, scope.doc.file, inst.line, inst.col);
    return null;
  }
  const instanceId = refdes;

  if (parts.length === 3) {
    const unit = Number(parts[1]);
    const name = parts[2]!;
    const pin = facts.pins.find((p) => p.name === name && p.unit === unit);
    if (!pin) {
      diagnostics.add(
        "error",
        "net.member-unknown",
        `component ${inst.componentId} has no pin ${name} in unit ${unit}`,
        scope.doc.file,
        inst.line,
        inst.col,
        { data: { component_id: inst.componentId, unit, pin: name } },
      );
      return null;
    }
    return `${instanceId}.${pin.number}`;
  }

  const needle = parts[1]!;
  const byName = facts.pins.find((p) => p.name === needle);
  const byNumber = facts.pins.find((p) => p.number === needle);
  if (byName && byNumber && byName.number !== byNumber.number) {
    diagnostics.add(
      "error",
      "ref.ambiguous-pin",
      `${ref} matches both a pin name and a pin number`,
      scope.doc.file,
      inst.line,
      inst.col,
      { hint: "use the pin number instead" },
    );
    return null;
  }
  const pin = byName ?? byNumber;
  if (!pin) {
    diagnostics.add(
      "error",
      "net.member-unknown",
      `component ${inst.componentId} has no pin ${needle}`,
      scope.doc.file,
      inst.line,
      inst.col,
      { data: { component_id: inst.componentId, pin: needle } },
    );
    return null;
  }
  return `${instanceId}.${pin.number}`;
}

/** A constraint row → IR constraint. */
function buildConstraint(
  raw: RawConstraint,
  scope: Scope,
  resolver: ComponentResolver | undefined,
  diagnostics: Diagnostics,
): Constraint | null {
  const file = scope.doc.file;
  const fail = (message: string, expected?: string, actual?: string): null => {
    diagnostics.add("error", "syntax.invalid-literal", message, file, raw.line, raw.col, {
      ...(expected !== undefined ? { expected } : {}),
      ...(actual !== undefined ? { actual } : {}),
    });
    return null;
  };

  // subject: nets first, then pin references.
  const resolveSubject = (text: string, netOnly: boolean): string | null => {
    if (scope.nets.has(text)) return text;
    if (netOnly || !text.includes(".")) {
      diagnostics.add("error", "ref.unknown-net", `net ${text} does not exist`, file, raw.line, raw.col);
      return null;
    }
    return resolvePinRef(scope, text, resolver, diagnostics);
  };

  switch (raw.type) {
    case "voltage":
    case "current":
    case "power": {
      if (raw.args.length !== 2) return fail(`a ${raw.type} constraint must be written as ${raw.type} <subject> <value>`);
      const subject = resolveSubject(raw.args[0]!, false);
      if (subject === null) return null;
      if (raw.type === "voltage") {
        // Voltage is a range: `voltage <subject> <min>..<max>`.
        const range = parseQuantityRange(raw.args[1]!, "voltage", { code: "value.invalid-value" });
        if (!range.ok) return fail(`invalid value for voltage constraint: ${range.reason}`);
        return { type: "voltage", subject: subject as NetOrPinRef, min_uv: range.min, max_uv: range.max };
      }
      if (raw.type === "current") {
        const parsed = parseQuantity(raw.args[1]!, "current", { code: "value.invalid-value" });
        if (!parsed.ok) return fail(`invalid value for current constraint: ${parsed.reason}`);
        return { type: "current", subject: subject as NetOrPinRef, max_na: parsed.value };
      }
      const power = parseQuantity(raw.args[1]!, "power", { code: "value.invalid-value" });
      if (!power.ok) return fail(`invalid value for power constraint: ${power.reason}`);
      return { type: "power", subject: subject as NetOrPinRef, max_uw: power.value };
    }
    case "impedance": {
      if (raw.args.length !== 2) return fail("an impedance constraint must be written as impedance <net> <value>");
      const net = resolveSubject(raw.args[0]!, true);
      if (net === null) return null;
      const parsed = parseQuantity(raw.args[1]!, "impedance", { code: "value.invalid-value" });
      if (!parsed.ok) return fail(`invalid value for impedance constraint: ${parsed.reason}`);
      return { type: "impedance", net, value_mohm: parsed.value };
    }
    case "length": {
      if (raw.args.length !== 2) return fail("a length constraint must be written as length <net> <min>..<max>");
      const net = resolveSubject(raw.args[0]!, true);
      if (net === null) return null;
      const parts = raw.args[1]!.split("..");
      if (parts.length !== 2) return fail(`a length constraint must be written as a range: ${raw.args[1]}`);
      const min = parseLengthNm(parts[0]!, file, raw.line, raw.col, "mm", "value.invalid-value");
      if (!min.ok) return fail(`invalid lower bound for length constraint: ${min.diagnostic.message}`);
      const max = parseLengthNm(parts[1]!, file, raw.line, raw.col, "mm", "value.invalid-value");
      if (!max.ok) return fail(`invalid upper bound for length constraint: ${max.diagnostic.message}`);
      if (min.value > max.value) return fail(`length constraint lower bound exceeds upper bound: ${raw.args[1]}`);
      return { type: "length", net, min_nm: min.value, max_nm: max.value };
    }
    case "diff": {
      if (raw.args.length < 3 || raw.args.length > 4) {
        return fail("a diff constraint must be written as diff <netA> <netB> <impedance> [tolerance]");
      }
      const netA = resolveSubject(raw.args[0]!, true);
      const netB = resolveSubject(raw.args[1]!, true);
      if (netA === null || netB === null) return null;
      const impedance = parseQuantity(raw.args[2]!, "impedance", { code: "value.invalid-value" });
      if (!impedance.ok) return fail(`invalid impedance for diff constraint: ${impedance.reason}`);
      const constraint: Constraint = {
        type: "diff",
        net_a: netA,
        net_b: netB,
        impedance_mohm: impedance.value,
      };
      if (raw.args.length === 4) {
        const tolerance = parseQuantity(raw.args[3]!, "percent", { code: "value.invalid-value" });
        if (!tolerance.ok) return fail(`invalid tolerance for diff constraint: ${tolerance.reason}`);
        constraint.tolerance_ppm = tolerance.value;
      }
      return constraint;
    }
    case "skew": {
      if (raw.args.length !== 4) return fail("a skew constraint must be written as skew <netA> <netB> <op> <length>");
      const netA = resolveSubject(raw.args[0]!, true);
      const netB = resolveSubject(raw.args[1]!, true);
      if (netA === null || netB === null) return null;
      const op = raw.args[2]!;
      if (op !== "<" && op !== "<=" && op !== ">" && op !== ">=") {
        return fail(`invalid comparison operator for skew constraint: ${op}`, "< | <= | > | >=", op);
      }
      const length = parseLengthNm(raw.args[3]!, file, raw.line, raw.col, "mm", "value.invalid-value");
      if (!length.ok) return fail(`invalid length for skew constraint: ${length.diagnostic.message}`);
      return { type: "skew", net_a: netA, net_b: netB, op, length_nm: length.value };
    }
    default:
      return fail(`unknown constraint type: ${raw.type}`);
  }
}
