// `texteda export gerbers`: the board's manufacturing layers, from the pcb description (ADR-0054,
// backlog F15).
//
// The chain is one direction and every step is a projection of the step above:
//
//   design/pcb/<board>.teda  →  pcb IR  →  fill (derived, ADR-0054 D3)  →  board image  →  text
//
// Nothing here writes back: the pour is recomputed on every export and never stored in the IR
// (ADR-0054 D2), so a file can never disagree with the description it came from. The `source_hash`
// stamped on every file is the project hash of the tree this export was projected from, which is what
// makes a delivered packet traceable to a build (invariant 11).
//
// Usage:
//   texteda export gerbers <project dir> <board_id> [--out <dir>] [--json]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { diagnosticsToPayload, type Diagnostic } from "@texteda/ir/diagnostics";
import { parsePcb, parseSchematic } from "@texteda/parser";
import { boardImage, fillBoard, fillBoardFacts, type FillOutput } from "@texteda/core";
import { toExcellon, toGerber } from "@texteda/exporter";
import type { ManufacturingFile, ManufacturingStamp } from "@texteda/core/image";
import { buildIrTree, toolVersion } from "./ir-tree.ts";
import { loadBoard, loadComponents, loadModules, loadPcb } from "./project.ts";
import { footprintsByInstance, loadFootprintLibrary, withPackageCodes } from "./pads.ts";
import { instanceValueText } from "./symbols.ts";
import { LAYOUT } from "./paths.ts";

export interface ExportOptions {
  /** Project root directory. */
  root: string;
  /** Board id: the pcb description's file name. */
  board: string;
  /** Output directory; defaults to `<root>/dist/fab/<board>`. */
  outDir?: string | undefined;
  /** Print the machine payload instead of the human summary. */
  json: boolean;
}

export interface ExportResult {
  /** Exit code: 0 written, 1 errors present. */
  exitCode: number;
  /** Diagnostics that stopped or annotated the export. */
  diagnostics: Diagnostic[];
  /** Files written, relative to the output directory. */
  files: { name: string; bytes: number }[];
  /** The stamp every file carries. */
  stamp: ManufacturingStamp;
  /** One entry per pour, with its area: what the fill decided, for a caller that wants to check it. */
  pours: { net: string; layer: string; area_nm2: number }[];
}

/**
 * Assemble and write the manufacturing files of one board.
 *
 * Errors stop the export, for the same reason `ir` refuses to write a tree: a Gerber file produced
 * from a design with holes in it would be delivered as if it were right, and nothing downstream can
 * tell the difference.
 */
export function runExport(options: ExportOptions): ExportResult {
  const diagnostics: Diagnostic[] = [];
  /** Refuse the export: no file is written from a design that has holes in it. */
  const refuse = (stamp: ManufacturingStamp = { tool_version: toolVersion(), source_hash: "" }): ExportResult => ({
    exitCode: 1,
    diagnostics,
    files: [],
    stamp,
    pours: [],
  });
  const board = loadBoard(options.root, options.board);
  if (!board) {
    diagnostics.push({
      code: "cli.export-no-board",
      severity: "error",
      message: `board ${options.board} has no schematic: a board always has one (ADR-0035 D5), and the pads come from it`,
      location: { file: `${LAYOUT.pcb}/${options.board}.teda`, line: 1, col: 1 },
      data: { board: options.board, missing: LAYOUT.sch },
    });
    return refuse();
  }
  const pcbSource = loadPcb(options.root, options.board);
  if (!pcbSource) {
    diagnostics.push({
      code: "cli.export-no-board",
      severity: "error",
      message: `board ${options.board} has no pcb description: there is nothing to export`,
      location: { file: `${LAYOUT.pcb}/${options.board}.teda`, line: 1, col: 1 },
      data: { board: options.board, missing: LAYOUT.pcb },
    });
    return refuse();
  }

  const { resolver, devices: loadedDevices, diagnostics: componentDiagnostics } = loadComponents(options.root);
  diagnostics.push(...componentDiagnostics);
  const modules = loadModules(options.root);
  const schematic = parseSchematic(board.text, {
    file: board.file,
    board: options.board,
    components: resolver,
    modules,
  });
  diagnostics.push(...schematic.diagnostics);
  const pcb = parsePcb(pcbSource.text, { file: pcbSource.file, board: options.board });
  diagnostics.push(...pcb.diagnostics);
  if (!schematic.ir || !pcb.ir) return refuse();

  const library = loadFootprintLibrary(options.root, diagnostics);
  const devices = withPackageCodes(loadedDevices, library);
  /** Which net a pin belongs to: a pour must treat same-net copper as its own (ADR-0054 D3). */
  const pinNet = new Map<string, string>();
  for (const net of schematic.ir.nets) for (const member of net.members) pinNet.set(member, net.id);

  const facts = fillBoardFacts({
    file: pcbSource.file,
    pcb: pcb.ir,
    placed: footprintsByInstance(schematic.ir, devices, library),
    pin_net: pinNet,
  });
  const fill = fillBoard(facts);
  diagnostics.push(...fill.diagnostics);
  const pours: FillOutput[] = fill.zones;

  // The project hash identifies the state of the design this packet came from, so it is the build's
  // own number — not a hash of the Gerber bytes, which would only say "some file was written".
  const tree = buildIrTree(options.root);
  const stamp: ManufacturingStamp = { tool_version: toolVersion(), source_hash: tree.projectHash };

  // Silkscreen text: a value is not a fact of the land pattern (a generic cannot hold one, a part's
  // value is its MPN), so the schematic's instance row is the only place it can come from — the same
  // string the print page puts on the drawing (ADR-0027).
  const values = new Map<string, string>();
  for (const instance of schematic.ir.instances) {
    const text = instanceValueText(instance, devices.get(instance.component));
    if (text !== undefined) values.set(instance.id, text);
  }

  const image = boardImage({
    pcb: pcb.ir,
    placed: footprintsByInstance(schematic.ir, devices, library),
    fill: pours,
    values,
  });
  const files: ManufacturingFile[] = [...toGerber(image, stamp), ...toExcellon(image, stamp)];

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return refuse(stamp);

  const outDir = resolve(options.outDir ?? join(options.root, "dist", "fab", options.board));
  mkdirSync(outDir, { recursive: true });
  const written = files.map((file) => {
    writeFileSync(join(outDir, file.name), file.text);
    return { name: file.name, bytes: Buffer.byteLength(file.text, "utf8") };
  });

  return {
    exitCode: 0,
    diagnostics,
    files: written,
    stamp,
    pours: pours.map((pour) => ({ net: pour.net, layer: pour.layer, area_nm2: pour.area_nm2 })),
  };
}

/** Print the result and return the exit code: machine payload in `--json`, human lines otherwise. */
export function reportExport(result: ExportResult, options: ExportOptions, outDir: string): number {
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          board: options.board,
          source_hash: result.stamp.source_hash,
          tool_version: result.stamp.tool_version,
          out_dir: relativePath(options.root, outDir),
          files: result.files,
          pours: result.pours,
          diagnostics: diagnosticsToPayload(result.diagnostics),
        },
        null,
        2,
      ),
    );
    return result.exitCode;
  }
  for (const diagnostic of result.diagnostics) {
    const where = diagnostic.location
      ? `${diagnostic.location.file}:${diagnostic.location.line}:${diagnostic.location.col}: `
      : "";
    console.error(`${where}${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (result.exitCode !== 0) {
    console.error("Manufacturing files not written: the project has errors");
    return result.exitCode;
  }
  console.error(`Wrote ${result.files.length} files to ${relativePath(options.root, outDir)}`);
  for (const file of result.files) console.error(`  ${file.name} (${file.bytes} bytes)`);
  for (const pour of result.pours) {
    console.error(`  pour ${pour.net} on ${pour.layer}: ${(pour.area_nm2 / 1_000_000_000_000).toFixed(4)} mm²`);
  }
  console.error(`Project hash: ${result.stamp.source_hash}`);
  return 0;
}

/** A path for display: relative to the project when it is inside it, absolute otherwise. */
function relativePath(root: string, path: string): string {
  const rel = relative(root, path);
  return rel.length > 0 && !rel.startsWith("..") ? rel : path;
}
