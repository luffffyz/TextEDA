// `schematic` description parsing: source text → board-level IR (teda.md §7, ADR-0025).
//
// One board = one file: `sch/<board_id>.teda` holds the board's instances, nets, ports and constraints.
// There is no page level, no second namespace and no flattening (ADR-0025 decision 1-3).
//
// The parser never touches the filesystem: component contents are supplied by the caller (`ComponentResolver`),
// so the `parser` package still runs in the browser (ADR-0009 decision 1).
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
import { checkVersion, typeRange, type VersionRange } from "./version.ts";
import { byteCompare, naturalCompare, pinRefCompare } from "@texteda/ir/order";
import { parseQuantity, parseQuantityRange, type QuantityKind } from "./quantities.ts";
import { parseLengthNm } from "./units.ts";

/** The `schematic` type exists since 0.1 (teda.md §13). */
const VERSION_RANGE: Record<DocumentKind, VersionRange> = {
  schematic: typeRange(1),
};

const REFDES_RE = /^[A-Z]+[0-9]+$/;
const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const NET_ID_RE = /^[A-Za-z0-9_+-]+$/;
const PORT_ID_RE = /^[A-Za-z0-9_+-]+$/;

/**
 * The first-column marker of a continuation row: a bare `:` adds members to the net named by the row above.
 * The marker is explicit rather than inferred from indentation, because indentation carries no meaning in `.teda` (teda.md §3).
 */
const CONTINUATION = ":";

/** Component parameter declaration (from a `component`'s `params` section). */
export interface ComponentParamDecl {
  name: string;
  /** `resistance` / `capacitance` / `voltage` / `percent` / `power` / `string` … */
  type: string;
  required: boolean;
}

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
}

export interface SchematicParseOptions {
  /** Board file (relative to the project root), written into the IR's `source.file`. */
  file: string;
  /** board_id. */
  board: string;
  /** Component resolver; if omitted, every `instances` row reports "component not found". */
  components?: ComponentResolver;
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

/** The document type of a board file. */
export type DocumentKind = "schematic";

export interface Document {
  id: string;
  version: string;
  file: string;
  instances: RawInstance[];
  nets: RawNet[];
  ports: RawPort[];
  constraints: RawConstraint[];
  buses: RawBus[];
}

export interface DocumentParseOptions {
  file: string;
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

/** Parse a single `schematic` document. */
export function parseSchematicDocument(text: string, options: DocumentParseOptions): DocumentParseResult {
  const { file } = options;
  const diagnostics = new Diagnostics();
  const lines = lex(text).filter((l) => !l.blank && !l.comment);

  const versionLine = lines[0];
  if (!versionLine || versionLine.cells[0]?.text !== "version") {
    diagnostics.add("error", "syntax.header-invalid", "the first line must be version <ver>", file, 1, 1);
    return { ok: false, diagnostics: diagnostics.items };
  }
  const version = versionLine.cells[1]?.text ?? "";
  const verdict = checkVersion(version, VERSION_RANGE.schematic, "schematic");
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
  const expectedType = "schematic";
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
        doc.ports.push({ id: portId, net: cells[1]!.text, line: line.number, col: cells[0]!.col });
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

  /* -------- instances -------- */

  const instances: Instance[] = [];
  const instanceOrigin = new Map<string, { file: string; line: number; col: number }>();
  for (const inst of scope.instances.values()) {
    const facts = resolver?.resolve(inst.componentId);
    if (!facts) {
      diagnostics.add(
        "error",
        "ref.unknown-component",
        `component ${inst.componentId} not found`,
        boardDoc.file,
        inst.line,
        inst.col,
        { expected: `components/ contains ${inst.componentId}.teda`, data: { component_id: inst.componentId, refdes: inst.refdes } },
      );
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

  /* -------- nets -------- */

  const nets: Net[] = [];
  const netOrigin = new Map<string, { file: string; line: number }>(); // net → declaration location
  for (const net of boardDoc.nets) {
    const members: string[] = [];
    for (const ref of net.memberRefs) {
      const resolved = resolvePinRef(scope, ref, resolver, diagnostics);
      if (resolved !== null) members.push(resolved);
    }
    nets.push({ id: net.name, members });
    netOrigin.set(net.name, { file: boardDoc.file, line: net.line });
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

  /* -------- assembly -------- */

  instances.sort((a, b) => naturalCompare(a.id, b.id));
  nets.sort((a, b) => byteCompare(a.id, b.id));
  ports.sort((a, b) => byteCompare(a.id, b.id));

  const ir: Schematic = {
    ir_version: "0.2",
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

/** Parameter columns of an instance row → the IR's param_value list. */
function resolveParams(
  inst: RawInstance,
  facts: ComponentFactsLite,
  file: string,
  diagnostics: Diagnostics,
): ParamValue[] {
  const decls = facts.params;
  const required = decls.filter((d) => d.required).length;
  if (inst.paramCells.length > decls.length) {
    diagnostics.add(
      "error",
      "value.param-count-mismatch",
      `component ${inst.componentId} declares ${decls.length} parameters, but the row gives ${inst.paramCells.length}`,
      file,
      inst.line,
      inst.col,
      { expected: `at most ${decls.length} columns`, actual: `${inst.paramCells.length} columns` },
    );
    return [];
  }
  if (inst.paramCells.length < required) {
    diagnostics.add(
      "error",
      "value.param-count-mismatch",
      `component ${inst.componentId} has ${required} required parameters, but the row gives only ${inst.paramCells.length}`,
      file,
      inst.line,
      inst.col,
      { expected: `at least ${required} columns`, actual: `${inst.paramCells.length} columns` },
    );
    return [];
  }

  const params: ParamValue[] = [];
  for (let i = 0; i < inst.paramCells.length; i += 1) {
    const decl = decls[i]!;
    const text = inst.paramCells[i]!;
    if (decl.type === "string") {
      params.push({ name: decl.name, text });
      continue;
    }
    const kind = PARAM_TYPE_KINDS[decl.type];
    if (kind === undefined) {
      diagnostics.add(
        "error",
        "value.unknown-param-type",
        `parameter ${decl.name} of component ${inst.componentId} declares unknown type ${decl.type}`,
        file,
        inst.line,
        inst.col,
      );
      continue;
    }
    const parsed = parseQuantity(text, kind, { code: "value.invalid-param" });
    if (!parsed.ok) {
      diagnostics.add(
        "error",
        "value.invalid-param",
        `invalid value for parameter ${decl.name}: ${parsed.reason}`,
        file,
        inst.line,
        inst.col,
        { expected: `a value of type ${decl.type}`, actual: text },
      );
      continue;
    }
    params.push({ name: decl.name, value: parsed.value });
  }
  return params;
}

/** Component parameter type → quantity kind. */
const PARAM_TYPE_KINDS: Record<string, QuantityKind> = {
  resistance: "resistance",
  capacitance: "capacitance",
  inductance: "inductance",
  voltage: "voltage",
  current: "current",
  power: "power",
  impedance: "impedance",
  percent: "percent",
  frequency: "frequency",
  temperature: "temperature",
};

/** Resolve a pin reference → `<instance_id>.<pin_number>`. */
function resolvePinRef(
  scope: Scope,
  ref: string,
  resolver: ComponentResolver | undefined,
  diagnostics: Diagnostics,
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
      `instance ${refdes} does not exist in this board`,
      scope.doc.file,
      1,
      1,
    );
    return null;
  }
  const facts = resolver?.resolve(inst.componentId);
  if (!facts) {
    diagnostics.add(
      "error",
      "ref.unknown-component",
      `component ${inst.componentId} not found`,
      scope.doc.file,
      inst.line,
      inst.col,
      { data: { component_id: inst.componentId } },
    );
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
