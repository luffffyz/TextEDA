// Project ↔ print page cross checks (spec/schematic-view.md §9).
//
// A view is a drawing of the project's logical model, not a second description of it: it names the
// project's ids and defines none (ADR-0035, ADR-0069 D4). So everything it says about project logic
// has to be answerable by the project root, and the drawing that says nothing about a net is a
// finding of its own — a project whose two-member net is drawn nowhere has a connection its drawing
// does not show.
//
// Scope is the table in §9.1 / §9.2: identity and graph rules live here; renderer-owned pin
// coordinates reject dangling endpoints and junction crossings that should be explicit endpoints.
//
// Module boxes and ports may be drawn on any page. A page draws only the project facts it references;
// no page role or required overview page owns module coverage (ADR-0069 D4).
//
// Pure: the project's IR and the pages' IR in, diagnostics out.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicView } from "@texteda/ir/schematic-view";
import { wirePath, ON_LINE_NM, type Point } from "./geometry.ts";
import { viewModuleFacts, viewCompositionFacts, type ModuleDrawingFacts, type SheetTemplateFacts, type ReadabilityGeometry } from "./facts.ts";

/** One print page of the project. */
export interface ViewPage {
  /** Path of the view file, relative to the project root. */
  readonly file: string;
  readonly view: SchematicView;
  /** Renderer-owned symbol pin coordinates for this page. */
  readonly geometry?: ReadabilityGeometry;
  /**
   * A record's IR path (`/place/3`) → where it was written. The view IR carries no line numbers
   * (ADR-0004 D1), so a finding that names a row gets the row's span from the parse.
   */
  readonly locate?: (irPath: string) => DiagnosticLocation | undefined;
}

/** A project net's declaration, for the view findings that contradict it (ADR-0004 D5). */
export type NetLocator = (netId: string) => DiagnosticLocation | undefined;

/** One port a module declares, with the project net the root binds it to (spec/module.md §3). */
export interface ProjectModulePort {
  /** The port name as the module declares it (`SYS_OUT`). */
  readonly id: string;
  /** The project net this port is bound to; absent when no project net binds the port. */
  readonly net?: string | undefined;
}

/** A project module instance and the ports its module declares (spec/module.md §7.2). */
export interface ProjectModule {
  /** Module instance id (`M1`). */
  readonly instance_id: string;
  /** The module the instance points at (`charger-power`). */
  readonly module_id: string;
  /** The ports the module declares, with the project net each one is bound to. */
  readonly ports: readonly ProjectModulePort[];
}

/** A module definition's electrical identity sets, used to validate its advisory drawing. */
export interface ModuleDefinitionFacts {
  readonly module_id: string;
  readonly instance_ids: readonly string[];
  readonly net_ids: readonly string[];
  readonly ports: readonly ProjectModulePort[];
}

export interface ViewFacts {
  /** Path of the project's schematic root, design/sch/main.teda. */
  readonly file: string;
  /** The one project-level logical root. */
  readonly schematic: Schematic;
  /** Every print page of the project; an empty list means "no drawing", which is a legal state. */
  readonly pages: readonly ViewPage[];
  /** A net id → the root row that declares it; the drawing is checked against that row. */
  readonly locateNet?: NetLocator;
  /**
   * Project module instances with their declared ports and root-bound project nets. The root IR is
   * flat for ordinary consumers, so parser facts preserve these bindings for view checks.
   */
  readonly modules?: readonly ProjectModule[] | undefined;
  /** Reusable local drawings and templates available to composed pages. */
  readonly moduleDrawings?: readonly ModuleDrawingFacts[] | undefined;
  readonly templates?: readonly SheetTemplateFacts[] | undefined;
  readonly moduleDefinitions?: readonly ModuleDefinitionFacts[] | undefined;
  readonly locateModuleDrawing?: (moduleId: string, irPath: string) => DiagnosticLocation | undefined;
  readonly locateTemplate?: (templateId: string, irPath: string) => DiagnosticLocation | undefined;
}

/**
 * A module-port endpoint (`M1.PORT`): the port `PORT` of the module instance `M1` (ADR-0067 D3).
 *
 * A project refdes may not take the `M<digits>` shape (spec/module.md §4), so the prefix of such an
 * endpoint is never a pin of a placed instance. The port name carries no dot, so a pin of a
 * component inside a module (`M1.U1.3`) is not one of these.
 */
const MODULE_PORT_ENDPOINT = /^(M[0-9]+)\.([A-Za-z0-9_+-]+)$/;

/** The pin half of a `pin` reference (`U1.3` → `3`), the same shape the nets section uses. */
function pinOf(member: string): string {
  const dot = member.lastIndexOf(".");
  return dot === -1 ? member : member.slice(dot + 1);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const dx = end.x_nm - start.x_nm;
  const dy = end.y_nm - start.y_nm;
  const cross = (point.x_nm - start.x_nm) * dy - (point.y_nm - start.y_nm) * dx;
  if (Math.abs(cross) > ON_LINE_NM * Math.max(Math.abs(dx), Math.abs(dy), 1)) return false;
  return (
    point.x_nm >= Math.min(start.x_nm, end.x_nm) - ON_LINE_NM &&
    point.x_nm <= Math.max(start.x_nm, end.x_nm) + ON_LINE_NM &&
    point.y_nm >= Math.min(start.y_nm, end.y_nm) - ON_LINE_NM &&
    point.y_nm <= Math.max(start.y_nm, end.y_nm) + ON_LINE_NM
  );
}

/**
 * Cross-check every print page against the project root, then report project-wide drawing coverage.
 *
 * An instance, net, port, module or interconnect that the root does not have cannot be invented by
 * a page. Coverage is advisory and reported once when at least one page exists; a project with
 * logic and no drawing is a legal state (ADR-0035, ADR-0069 D4).
 */
export function checkViews(facts: ViewFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { schematic } = facts;

  const instances = new Set(schematic.instances.map((instance) => instance.id));
  const nets = new Map(schematic.nets.map((net) => [net.id, net]));
  const ports = new Set((schematic.ports ?? []).map((port) => port.id));
  /** The project's module instances, by instance id (spec/module.md §7.2). */
  const modules = facts.modules ?? [];
  const modulesByInstance = new Map(modules.map((module) => [module.instance_id, module]));
  const interconnects = new Map((schematic.interconnects ?? []).map((interconnect) => [interconnect.id, interconnect]));
  // The first-page convention may sort `main` first, but every page draws the same project root.
  const pages = [...facts.pages].sort((a, b) => {
    if (a.view.page === b.view.page) return 0;
    if (a.view.page === "main") return -1;
    if (b.view.page === "main") return 1;
    return a.view.page < b.view.page ? -1 : 1;
  });
  /** Net ids that some page draws with a wire or a label. */
  const drawn = new Set<string>();
  /** Module instances represented by a frame or a reusable module drawing on any page. */
  const drawnModules = new Set<string>();
  /** Root interconnect ids represented by an id-matching row on any page. */
  const drawnInterconnects = new Set<string>();

  /** The project's row for a net: the definition the drawing is checked against (ADR-0004 D5). */
  const netRow = (netId: string): { related?: DiagnosticLocation[] } => {
    const row = facts.locateNet?.(netId);
    return row === undefined ? {} : { related: [row] };
  };

  const moduleDrawings = new Map((facts.moduleDrawings ?? []).map((drawing) => [drawing.module_id, drawing]));
  const templates = new Map((facts.templates ?? []).map((template) => [template.template_id, template]));
  const definitions = new Map((facts.moduleDefinitions ?? []).map((definition) => [definition.module_id, definition]));
  for (const drawing of facts.moduleDrawings ?? []) {
    const definition = definitions.get(drawing.module_id);
    const drawingAt = (path: string): DiagnosticLocation => facts.locateModuleDrawing?.(drawing.module_id, path) ?? { file: facts.file, line: 1, col: 1 };
    if (facts.moduleDefinitions !== undefined && definition === undefined) {
      diagnostics.push({ code: "ref.unknown-module", severity: "error", message: `module drawing ${drawing.module_id} has no matching module definition`, hint: "draw a module declared by the project", location: drawingAt("/module_id"), data: { module_id: drawing.module_id } });
      continue;
    }
    if (definition === undefined) continue;
    const validInstances = new Set(definition.instance_ids);
    const validNets = new Set(definition.net_ids);
    const validPorts = new Set(definition.ports.map((port) => port.id));
    for (const [index, place] of drawing.place.entries()) if (!validInstances.has(place.instance_id)) diagnostics.push({
      code: "ref.unknown-instance", severity: "error", message: `module drawing ${drawing.module_id} places unknown local instance ${place.instance_id}`,
      hint: "draw only instances declared by the module definition", location: drawingAt(`/place/${index}`), data: { module_id: drawing.module_id, instance: place.instance_id },
    });
    for (const [index, port] of drawing.port.entries()) if (!validPorts.has(port.id)) diagnostics.push({
      code: "ref.unknown-port", severity: "error", message: `module drawing ${drawing.module_id} shows undeclared port ${port.id}`,
      hint: "draw a port declared by the module definition", location: drawingAt(`/port/${index}`), data: { module_id: drawing.module_id, port: port.id },
    });
    const wireRows = drawing.wire ?? [];
    for (const [index, wire] of wireRows.entries()) if (!validNets.has(wire.net)) diagnostics.push({
      code: "ref.unknown-net", severity: "error", message: `module drawing ${drawing.module_id} draws unknown local net ${wire.net}`,
      hint: "draw only nets declared by the module definition", location: drawingAt(`/wire/${index}`), data: { module_id: drawing.module_id, net: wire.net },
    });
    for (const [index, label] of (drawing.label ?? []).entries()) if (!validNets.has(label.net)) diagnostics.push({
      code: "ref.unknown-net", severity: "error", message: `module drawing ${drawing.module_id} labels unknown local net ${label.net}`,
      hint: "draw only nets declared by the module definition", location: drawingAt(`/label/${index}`), data: { module_id: drawing.module_id, net: label.net },
    });
    const points = [
      ...(drawing.points ?? []), ...(drawing.port ?? []).map((port) => ({ x_nm: port.x_nm, y_nm: port.y_nm })),
      ...(drawing.label ?? []).map((label) => ({ x_nm: label.x_nm, y_nm: label.y_nm })),
      ...wireRows.flatMap((wire) => wire.points ?? []),
    ];
    for (const point of points) if (point.x_nm < 0 || point.y_nm < 0 || point.x_nm > drawing.bounds.width_nm || point.y_nm > drawing.bounds.height_nm) {
      diagnostics.push({ code: "view.out-of-sheet", severity: "error", message: `module drawing ${drawing.module_id} has geometry outside its local bounds`, hint: "keep module drawing geometry inside its bounds", location: drawingAt("/bounds"), data: { module_id: drawing.module_id, x_nm: point.x_nm, y_nm: point.y_nm } });
      break;
    }
  }
  for (const { file, view, locate, geometry } of pages) {
    /** Where a record of this page was written; the file alone when no span came with the parse. */
    const at = (irPath: string): DiagnosticLocation => locate?.(irPath) ?? { file, line: 1, col: 1 };
    const composition = viewCompositionFacts(view);
    const template = composition.template === undefined ? undefined : templates.get(composition.template);
    if (composition.template !== undefined && template === undefined) diagnostics.push({
      code: "ref.unknown-module", severity: "error",
      message: `print page ${view.page} references missing sheet template ${composition.template}`,
      hint: "reference a sheet template that exists",
      location: at("/template"), data: { page: view.page, template: composition.template },
    });
    const extent = template?.size ?? view.sheet;
    if (template !== undefined) {
      const points = [
        ...(template.line ?? []).flatMap((row) => [row.start, row.end]),
        ...(template.rect ?? []).flatMap((row) => [row.start, row.end]),
        ...(template.polyline ?? []).flatMap((row) => [...row.points]),
        ...(template.text ?? []).map((row) => ({ x_nm: row.x_nm, y_nm: row.y_nm })),
      ];
      for (const point of points) if (point.x_nm < 0 || point.y_nm < 0 || point.x_nm > template.size.width_nm || point.y_nm > template.size.height_nm) {
        diagnostics.push({ code: "view.out-of-sheet", severity: "error", message: `sheet template ${template.template_id} has furniture outside its declared size`, hint: "keep template furniture inside its size", location: facts.locateTemplate?.(template.template_id, "/size") ?? at("/template"), data: { page: view.page, template: template.template_id, x_nm: point.x_nm, y_nm: point.y_nm } });
        break;
      }
    }
    const placements = [...(composition.module_place ?? [])].sort((a, b) => a.instance_id < b.instance_id ? -1 : a.instance_id > b.instance_id ? 1 : a.x_nm - b.x_nm || a.y_nm - b.y_nm);
    const placedPortPoints = new Map<string, Point>();
    for (const [index, placement] of placements.entries()) {
      const projectModule = modulesByInstance.get(placement.instance_id);
      if (projectModule === undefined) {
        diagnostics.push({ code: "view.module-unknown-instance", severity: "error", message: `print page ${view.page} places unknown module instance ${placement.instance_id}`, hint: "place a module instance declared by the project root", location: at(`/module_place/${index}`), data: { page: view.page, instance: placement.instance_id } });
        continue;
      }
      if (projectModule.module_id !== placement.module_id) diagnostics.push({ code: "view.module-id-mismatch", severity: "error", message: `module placement ${placement.instance_id} names ${placement.module_id}, but the project binds that instance to ${projectModule.module_id}`, hint: "place the module named by the project module instance", location: at(`/module_place/${index}`), data: { page: view.page, instance: placement.instance_id, module_id: placement.module_id, project_module_id: projectModule.module_id } });
      const drawing = moduleDrawings.get(projectModule.module_id);
      if (drawing === undefined) {
        diagnostics.push({ code: "ref.unknown-module", severity: "error", message: `print page ${view.page} places ${placement.instance_id}, but module drawing ${projectModule.module_id} is missing`, hint: "add a reusable drawing for this project module", location: at(`/module_place/${index}`), data: { page: view.page, instance: placement.instance_id, module_id: projectModule.module_id } });
        continue;
      }
      drawnModules.add(placement.instance_id);
      const rotated = placement.rot_mdeg === 90000 || placement.rot_mdeg === 270000;
      const width = rotated ? drawing.bounds.height_nm : drawing.bounds.width_nm;
      const height = rotated ? drawing.bounds.width_nm : drawing.bounds.height_nm;
      if (extent !== undefined && (placement.x_nm < 0 || placement.y_nm < 0 || placement.x_nm + width > extent.width_nm || placement.y_nm + height > extent.height_nm)) diagnostics.push({ code: "view.out-of-sheet", severity: "error", message: `module placement ${placement.instance_id} extends outside page ${view.page}`, hint: "move the placement inside the page extent", location: at(`/module_place/${index}`), data: { page: view.page, instance: placement.instance_id, module_id: projectModule.module_id } });
      for (const port of drawing.port) {
        let x = port.x_nm, y = port.y_nm;
        if (placement.rot_mdeg === 90000) [x, y] = [drawing.bounds.height_nm - y, x];
        else if (placement.rot_mdeg === 180000) [x, y] = [drawing.bounds.width_nm - x, drawing.bounds.height_nm - y];
        else if (placement.rot_mdeg === 270000) [x, y] = [y, drawing.bounds.width_nm - x];
        const key = `${placement.instance_id}.${port.id}`;
        if (!placedPortPoints.has(key)) placedPortPoints.set(key, { x_nm: placement.x_nm + x, y_nm: placement.y_nm + y });
      }
    }
    const junctions = new Map((view.junction ?? []).map((junction) => [junction.id, junction]));
    /** The module frames and the module ports this page draws (ADR-0067 D3). */
    const { module: moduleFrames, module_port: modulePortRows } = viewModuleFacts(view);
    const endpointPoints = new Map<string, Point>([
      ...(view.port ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
      ...(view.junction ?? []).map((junction) => [junction.id, { x_nm: junction.x_nm, y_nm: junction.y_nm }] as const),
      ...(modulePortRows ?? []).map((port) => [port.id, { x_nm: port.x_nm, y_nm: port.y_nm }] as const),
      ...placedPortPoints,
    ]);
    const symbols = new Map((geometry?.symbols ?? []).map((symbol) => [symbol.instance_id, symbol]));
    // A module instance is drawn as a frame with port markers, and its ports are wire endpoints.
    // `wirePath` resolves a dotted id through the symbols, so the module ports join them there.
    const modulePins = new Map<string, Map<string, Point>>();
    for (const port of modulePortRows ?? []) {
      const dot = port.id.indexOf(".");
      if (dot < 0) continue;
      const instanceId = port.id.slice(0, dot);
      const pins = modulePins.get(instanceId) ?? new Map<string, Point>();
      pins.set(port.id.slice(dot + 1), { x_nm: port.x_nm, y_nm: port.y_nm });
      modulePins.set(instanceId, pins);
    }
    for (const frame of moduleFrames ?? []) {
      if (symbols.has(frame.instance_id)) continue;
      const pins = modulePins.get(frame.instance_id);
      if (pins === undefined) continue;
      symbols.set(frame.instance_id, {
        instance_id: frame.instance_id,
        box: {
          min_x_nm: frame.x_nm,
          min_y_nm: frame.y_nm,
          max_x_nm: frame.x_nm + frame.width_nm,
          max_y_nm: frame.y_nm + frame.height_nm,
        },
        pins,
      });
    }
    const junctionNets = new Map<string, string>();
    const junctionDegrees = new Map<string, number>();
    const portNets = new Map((schematic.ports ?? []).map((port) => [port.id, port.net]));
    for (const [index, junction] of (view.junction ?? []).entries()) {
      if (!ports.has(junction.id)) continue;
      diagnostics.push({
        code: "value.duplicate-id",
        severity: "error",
        message: `junction ${junction.id} conflicts with a project port id`,
        hint: "give each page junction an id distinct from every project port",
        location: at(`/junction/${index}`),
        data: { page: view.page, id: junction.id },
      });
    }
    for (const [index, place] of (view.place ?? []).entries()) {
      if (instances.has(place.instance_id)) continue;
      diagnostics.push({
        code: "ref.unknown-instance",
        severity: "error",
        message: `print page ${view.page} places ${place.instance_id}, which the project's instances do not contain`,
        hint: "the view names the project's ids: place an instance the project has, or add it to the project root",
        location: at(`/place/${index}`),
        data: { page: view.page, instance: place.instance_id },
      });
    }

    // Frames are page-local: validate every drawing row without requiring any designated overview.
    /** The frame rows of each module instance on this page, in drawing order. */
    const frames = new Map<string, number[]>();
    for (const [index, frame] of (moduleFrames ?? []).entries()) {
      const frameRows = frames.get(frame.instance_id) ?? [];
      frameRows.push(index);
      frames.set(frame.instance_id, frameRows);
      const projectModule = modulesByInstance.get(frame.instance_id);
      if (projectModule === undefined) {
        diagnostics.push({
          code: "view.module-unknown-instance",
          severity: "error",
          message: `print page ${view.page} draws module instance ${frame.instance_id}, which the project's modules do not contain`,
          hint: "draw a module instance declared by the project root",
          location: at(`/module/${index}`),
          data: { page: view.page, instance: frame.instance_id },
        });
        continue;
      }
      if (projectModule.module_id !== frame.module_id) {
        diagnostics.push({
          code: "view.module-id-mismatch",
          severity: "error",
          message: `print page ${view.page} draws module instance ${frame.instance_id} as ${frame.module_id}, but the project binds that instance to ${projectModule.module_id}`,
          hint: "draw the module named by the project module instance",
          location: at(`/module/${index}`),
          data: { page: view.page, instance: frame.instance_id, module_id: frame.module_id, project_module_id: projectModule.module_id },
        });
        continue;
      }
      drawnModules.add(frame.instance_id);
    }
    for (const [instanceId, frameRows] of frames) {
      for (const index of frameRows.slice(1)) {
        diagnostics.push({
          code: "view.module-duplicate",
          severity: "error",
          message: `print page ${view.page} draws module instance ${instanceId} in ${frameRows.length} frames`,
          hint: "one frame per module instance on a page: keep one frame and drop the others",
          location: at(`/module/${index}`),
          data: { page: view.page, instance: instanceId, frames: frameRows.length },
        });
      }
    }

    // A module port names a port of a project module instance; the module file owns its declaration.
    for (const [index, port] of (modulePortRows ?? []).entries()) {
      const dot = port.id.indexOf(".");
      const instanceId = dot < 0 ? port.id : port.id.slice(0, dot);
      const portId = dot < 0 ? "" : port.id.slice(dot + 1);
      const projectModule = modulesByInstance.get(instanceId);
      if (projectModule === undefined) {
        diagnostics.push({
          code: "ref.unknown-port",
          severity: "error",
          message: `print page ${view.page} shows module port ${port.id}, but the project has no module instance ${instanceId}`,
          hint: "a module port names a port of a module instance declared by the project",
          location: at(`/module_port/${index}`),
          data: { page: view.page, port: port.id, instance: instanceId },
        });
        continue;
      }
      if (!projectModule.ports.some((declared) => declared.id === portId)) {
        diagnostics.push({
          code: "ref.unknown-port",
          severity: "error",
          message: `print page ${view.page} shows module port ${port.id}, but module ${projectModule.module_id} does not declare port ${portId}`,
          hint: "the module file owns its ports: draw a port the module declares",
          location: at(`/module_port/${index}`),
          data: { page: view.page, port: port.id, module_id: projectModule.module_id },
        });
      }
    }
    const drawnModulePorts = new Set<string>(placedPortPoints.keys());
    for (const port of modulePortRows ?? []) {
      const dot = port.id.indexOf(".");
      if (dot < 0) continue;
      const projectModule = modulesByInstance.get(port.id.slice(0, dot));
      if (projectModule?.ports.some((declared) => declared.id === port.id.slice(dot + 1))) drawnModulePorts.add(port.id);
    }
    for (const [index, row] of (view.interconnect ?? []).entries()) {
      const root = interconnects.get(row.id);
      if (root === undefined) {
        diagnostics.push({
          code: "ref.unknown-interconnect",
          severity: "error",
          message: `print page ${view.page} draws unknown project interconnect ${row.id}`,
          hint: "reference an interconnect declared by the project root",
          location: at(`/interconnect/${index}`),
          data: { page: view.page, interconnect: row.id },
        });
        continue;
      }
      if (row.from !== root.from || row.to !== root.to) {
        diagnostics.push({
          code: "view.interconnect-id-mismatch",
          severity: "error",
          message: `print page ${view.page} draws interconnect ${row.id} from ${row.from} to ${row.to}, but the project declares ${root.from} to ${root.to}`,
          hint: "copy the interconnect endpoints declared by the project root",
          location: at(`/interconnect/${index}`),
          data: { page: view.page, interconnect: row.id, from: row.from, to: row.to, project_from: root.from, project_to: root.to },
        });
        continue;
      }
      drawnInterconnects.add(row.id);
      for (const endpoint of [row.from, row.to]) {
        if (drawnModulePorts.has(endpoint)) continue;
        diagnostics.push({
          code: "view.module-port-not-drawn",
          severity: "error",
          message: `print page ${view.page} draws interconnect ${row.id} at module port ${endpoint}, but that port is not drawn on this page`,
          hint: "draw both interconnect endpoint module ports on the page",
          location: at(`/interconnect/${index}`),
          data: { page: view.page, interconnect: row.id, port: endpoint },
        });
      }
    }


    const placedInstances = new Set((view.place ?? []).map((place) => place.instance_id));
    const drawingGraphs = new Map<string, Map<string, Set<string>>>();
    for (const wire of view.wire ?? []) {
      for (const endpoint of [wire.from_pin, wire.to_pin]) {
        if (junctions.has(endpoint) && !junctionNets.has(endpoint)) junctionNets.set(endpoint, wire.net);
      }
    }
    for (const [index, wire] of (view.wire ?? []).entries()) {
      const net = nets.get(wire.net);
      if (!net) {
        diagnostics.push({
          code: "ref.unknown-net",
          severity: "error",
          message: `print page ${view.page} draws a wire on net ${wire.net}, which the project does not have`,
          hint: "the view names the project's nets: a wire cannot invent one",
          location: at(`/wire/${index}`),
          data: { page: view.page, net: wire.net },
        });
        continue;
      }
      drawn.add(net.id);
      let graph = drawingGraphs.get(net.id);
      if (graph === undefined) {
        graph = new Map();
        drawingGraphs.set(net.id, graph);
      }
      const from = wire.from_pin;
      const to = wire.to_pin;
      const adjacent = graph.get(from) ?? new Set<string>();
      adjacent.add(to);
      graph.set(from, adjacent);
      const reverse = graph.get(to) ?? new Set<string>();
      reverse.add(from);
      graph.set(to, reverse);
      if (geometry !== undefined) {
        const path = wirePath(wire, symbols, endpointPoints);
        if (path === null) {
          for (const endpoint of [wire.from_pin, wire.to_pin]) {
            // The exact endpoint first: a page port, a junction or a module port is drawn where the
            // page says it is; only then does a dotted id fall back to a pin of a placed instance.
            const dot = endpoint.lastIndexOf(".");
            const resolved =
              endpointPoints.has(endpoint) ||
              (dot > 0 && symbols.get(endpoint.slice(0, dot))?.pins.has(endpoint.slice(dot + 1)) === true);
            if (resolved) continue;
            diagnostics.push({
              code: "view.wire-dangling-endpoint",
              severity: "error",
              message: `wire endpoint ${endpoint} has no rendered connection point on page ${view.page}`,
              hint: "place the referenced pin or declare and draw the page endpoint",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, endpoint },
            });
          }
        } else {
          for (const [junctionId, junction] of junctions) {
            if (junctionNets.get(junctionId) !== net.id) continue;
            if (wire.from_pin === junctionId || wire.to_pin === junctionId) continue;
            const point = { x_nm: junction.x_nm, y_nm: junction.y_nm };
            if (!path.some((_, pathIndex) => pathIndex + 1 < path.length && pointOnSegment(point, path[pathIndex]!, path[pathIndex + 1]!))) continue;
            diagnostics.push({
              code: "view.wire-gap",
              severity: "error",
              message: `wire on ${net.id} passes through junction ${junctionId} without using it as an endpoint`,
              hint: "split the wire at the junction and use its declared id as the shared endpoint",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, junction: junctionId, wire: index },
            });
          }
        }
      }
      const members = new Set(net.members);
      for (const pin of [wire.from_pin, wire.to_pin]) {
        const modulePort = MODULE_PORT_ENDPOINT.exec(pin);
        if (modulePort !== null) {
          // A module port is the module's interface, not a pin: the project root says which ports the
          // module declares and which net each one is bound to (spec/module.md §7.2).
          const instanceId = modulePort[1]!;
          const portId = modulePort[2]!;
          const projectModule = modulesByInstance.get(instanceId);
          if (projectModule === undefined) {
            diagnostics.push({
              code: "ref.unknown-port",
              severity: "error",
              message: `print page ${view.page} ends a wire at module port ${pin}, but the project has no module instance ${instanceId}`,
              hint: "a wire may end at a port of a module instance the project declares",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, port: pin, instance: instanceId },
            });
            continue;
          }
          const declared = projectModule.ports.find((candidate) => candidate.id === portId);
          if (declared === undefined) {
            diagnostics.push({
              code: "ref.unknown-port",
              severity: "error",
              message: `print page ${view.page} ends a wire at module port ${pin}, but module ${projectModule.module_id} does not declare port ${portId}`,
              hint: "the module file owns its ports: end the wire at a port the module declares",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, port: pin, module_id: projectModule.module_id },
            });
            continue;
          }
          if (!drawnModulePorts.has(pin)) {
            diagnostics.push({
              code: "view.module-port-not-drawn",
              severity: "error",
              message: `print page ${view.page} ends a wire at module port ${pin}, which this page does not draw`,
              hint: "add a module_port row for the port, or end the wire where the page draws",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, port: pin },
            });
          }
          if (declared.net !== net.id) {
            diagnostics.push({
              code: "view.module-port-wrong-net",
              severity: "error",
              message: `module port ${pin} is bound to ${declared.net ?? "no project net"}, not ${net.id}`,
              hint: "the project root binds a module port to a net: draw the wire on the net the project names",
              location: at(`/wire/${index}`),
              data: { page: view.page, net: net.id, port: pin, bound_net: declared.net ?? "" },
            });
          }
          continue;
        }
        if (!pin.includes(".")) {
          if (junctions.has(pin)) {
            const owner = junctionNets.get(pin);
            if (owner !== undefined && owner !== net.id) {
              diagnostics.push({
                code: "view.endpoint-wrong-net",
                severity: "error",
                message: `junction ${pin} is used by both ${owner} and ${net.id}`,
                hint: "a drawing junction can join wires from only one net",
                location: at(`/wire/${index}`),
                data: { page: view.page, junction: pin, net: net.id, other_net: owner },
              });
            } else {
              junctionNets.set(pin, net.id);
            }
            junctionDegrees.set(pin, (junctionDegrees.get(pin) ?? 0) + 1);
          } else if (!ports.has(pin)) {
            diagnostics.push({
              code: "ref.unknown-junction",
              severity: "error",
              message: `wire endpoint ${pin} is neither a declared junction nor a project port`,
              hint: "declare a junction on this page or use a declared project port",
              location: at(`/wire/${index}`),
              data: { page: view.page, endpoint: pin },
            });
          } else if (portNets.get(pin) !== net.id) {
            diagnostics.push({
              code: "view.endpoint-wrong-net",
              severity: "error",
              message: `port ${pin} belongs to ${portNets.get(pin) ?? "no known net"}, not ${net.id}`,
              hint: "connect a project port only to a wire on its declared project net",
              location: at(`/wire/${index}`),
              data: { page: view.page, port: pin, net: net.id },
            });
          }
          continue;
        }
        if (members.has(pin)) continue;
        const instance = pin.slice(0, pin.lastIndexOf("."));
        const reason = instances.has(instance)
          ? `pin ${pinOf(pin)} is not a member of that net`
          : `${instance} is not an instance of this project`;
        diagnostics.push({
          code: "view.pin-net-mismatch",
          severity: "error",
          message: `print page ${view.page} draws ${pin} as an endpoint of net ${net.id}: ${reason}`,
          hint: "a wire connects two pins of the net it names; the net's members are decided in the project's nets section",
          location: at(`/wire/${index}`),
          data: { page: view.page, net: net.id, pin },
          ...netRow(net.id),
        });
      }
    }
    for (const [index, junction] of (view.junction ?? []).entries()) {
      const degree = junctionDegrees.get(junction.id) ?? 0;
      if (degree < 2) {
        diagnostics.push({
          code: "view.junction-isolated",
          severity: "error",
          message: `junction ${junction.id} has only ${degree} wire arm${degree === 1 ? "" : "s"}`,
          hint: "connect the junction to at least two wire rows, or remove it",
          location: at(`/junction/${index}`),
          data: { page: view.page, junction: junction.id, degree },
        });
      } else if (degree > 4) {
        diagnostics.push({
          code: "view.junction-invalid-degree",
          severity: "error",
          message: `junction ${junction.id} has ${degree} wire arms; the maximum is four`,
          hint: "split the drawing into simpler junctions",
          location: at(`/junction/${index}`),
          data: { page: view.page, junction: junction.id, degree },
        });
      }
    }
    for (const [netId, graph] of drawingGraphs) {
      const net = nets.get(netId)!;
      const missingMembers = net.members.filter((member) => {
        const instance = member.slice(0, member.lastIndexOf("."));
        return placedInstances.has(instance) && !graph.has(member);
      });
      const unseen = new Set(graph.keys());
      let components = 0;
      while (unseen.size > 0) {
        components += 1;
        const pending = [unseen.values().next().value as string];
        while (pending.length > 0) {
          const endpoint = pending.pop()!;
          if (!unseen.delete(endpoint)) continue;
          for (const adjacent of graph.get(endpoint) ?? []) if (unseen.has(adjacent)) pending.push(adjacent);
        }
      }
      if (components > 1 || missingMembers.length > 0) {
        diagnostics.push({
          code: "view.wire-disconnected",
          severity: "error",
          message: `print page ${view.page} draws net ${netId} as ${components} wire components${missingMembers.length > 0 ? ` and omits placed members ${missingMembers.join(", ")}` : ""}`,
          hint: "connect the wire components and include every member placed on this page",
          location: at("/wire"),
          data: { page: view.page, net: netId, components, missing_members: missingMembers.join(",") },
        });
      }
    }

    for (const [index, label] of (view.label ?? []).entries()) {
      if (!nets.has(label.net)) {
        diagnostics.push({
          code: "ref.unknown-net",
          severity: "error",
          message: `print page ${view.page} labels net ${label.net}, which the project does not have`,
          hint: "the view names the project's nets: a label cannot invent one",
          location: at(`/label/${index}`),
          data: { page: view.page, net: label.net },
        });
        continue;
      }
      drawn.add(label.net);
    }

    for (const [index, port] of (view.port ?? []).entries()) {
      if (ports.has(port.id)) continue;
      diagnostics.push({
        code: "ref.unknown-port",
        severity: "error",
        message: `print page ${view.page} shows port ${port.id}, which the project's ports section does not declare`,
        hint: "a port symbol draws an existing project port: declare the port on the project root, or use the net's label",
        location: at(`/port/${index}`),
        data: { page: view.page, port: port.id },
      });
    }
  }

  // Coverage is project-wide: no page role owns it, and each advisory finding is emitted once.
  if (pages.length > 0) {
    const undrawn = [...nets.values()]
      .filter((net) => net.members.length >= 2 && !drawn.has(net.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (undrawn.length > 0) {
      const shown = undrawn.slice(0, 10).map((net) => net.id);
      const rest = undrawn.length - shown.length;
      diagnostics.push({
        code: "view.nets-not-drawn",
        severity: "warning",
        message: `${undrawn.length} of ${nets.size} nets are drawn on no print page: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
        hint: "draw each as a wire between two of its pins, or put a label on its net: a connection that is on no page is not on the drawing",
        location: { file: facts.file, line: 1, col: 1 },
        data: { count: undrawn.length, nets: undrawn.map((net) => net.id).join(" "), pages: pages.length },
      });
    }
    const undrawnModules = modules.filter((module) => !drawnModules.has(module.instance_id));
    if (undrawnModules.length > 0) {
      const shown = undrawnModules.slice(0, 10).map((module) => module.instance_id);
      const rest = undrawnModules.length - shown.length;
      diagnostics.push({
        code: "view.modules-not-drawn",
        severity: "warning",
        message: `${undrawnModules.length} of ${modules.length} project module instances are drawn on no print page: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
        hint: "draw each project module instance on a topology or detail page",
        location: { file: facts.file, line: 1, col: 1 },
        data: { count: undrawnModules.length, modules: undrawnModules.map((module) => module.instance_id).join(" "), pages: pages.length },
      });
    }
    const undrawnInterconnects = [...interconnects.values()]
      .filter((interconnect) => !drawnInterconnects.has(interconnect.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (undrawnInterconnects.length > 0) {
      const shown = undrawnInterconnects.slice(0, 10).map((interconnect) => interconnect.id);
      const rest = undrawnInterconnects.length - shown.length;
      diagnostics.push({
        code: "view.interconnect-not-drawn",
        severity: "warning",
        message: `${undrawnInterconnects.length} of ${interconnects.size} project interconnects are drawn on no print page: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
        hint: "draw each declared interconnect on a topology or detail page",
        location: { file: facts.file, line: 1, col: 1 },
        data: { count: undrawnInterconnects.length, interconnects: undrawnInterconnects.map((interconnect) => interconnect.id).join(" "), pages: pages.length },
      });
    }
  }

  return diagnostics;
}
