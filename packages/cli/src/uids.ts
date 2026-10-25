// Project-wide stable instance UID checks (ADR-0051).
//
// The parser catches duplicates inside one file. A UID is project-scoped, so an entry point that
// sees several boards (check, the IR shard tree) must also catch a copy/paste that crossed a file.
import type { Diagnostic, DiagnosticLocation } from "@texteda/ir/diagnostics";
import type { SourceMap } from "@texteda/ir/spans";
import type { Schematic } from "@texteda/ir/schematic";
import { locateWith } from "./locate.ts";

/** One board's UIDs, as declared in the source and as flattened into its IR. */
export interface ProjectUidInput {
  board: string;
  file: string;
  sourceUids?: { uid: string; kind: "instance" | "module"; id: string; line: number; col: number }[];
  ir?: Schematic;
  sources?: SourceMap | undefined;
}

/**
 * Return one error per duplicated project-scoped UID. A duplicate inside one board is already
 * reported by the parser, so the project pass emits the cross-board case plus the one same-board
 * case the parser cannot see: a bare module-local UID (its module instance has no UID).
 */
export function checkProjectInstanceUids(items: readonly ProjectUidInput[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const owners = new Map<string, { board: string; id: string; location: DiagnosticLocation }>();

  const record = (uid: string, board: string, id: string, location: DiagnosticLocation): void => {
    const first = owners.get(uid);
    if (first === undefined) {
      owners.set(uid, { board, id, location });
      return;
    }
    // The parser owns the same-board duplicate; skip it here. The exception is a module-local UID
    // that lost its module prefix (no `/` in the UID while the instance id is dotted): it is a
    // different instance from the board-level row, so a same-board collision still surfaces.
    const bareModuleLocal = !uid.includes("/") && (first.id.includes(".") || id.includes("."));
    if (first.board === board && !bareModuleLocal) return;
    diagnostics.push({
      code: "value.duplicate-instance-uid",
      severity: "error",
      message: `instance uid ${uid} is used by ${first.board}.${first.id} and ${board}.${id}`,
      location,
      related: [first.location],
      data: {
        uid,
        first_board: first.board,
        first_instance: first.id,
        board,
        instance: id,
      },
    });
  };

  for (const item of items) {
    // The source list and the IR both carry a top-level instance UID; record the declaration
    // once. Module-local UIDs only exist in the IR, so they still reach the check below.
    const declaredKeys = new Set(
      (item.sourceUids ?? []).map((declared) => `${declared.uid}\u0000${declared.kind === "module" ? `module ${declared.id}` : declared.id}`),
    );
    for (const declared of item.sourceUids ?? []) {
      record(
        declared.uid,
        item.board,
        declared.kind === "module" ? `module ${declared.id}` : declared.id,
        { file: item.file, line: declared.line, col: declared.col },
      );
    }
    if (!item.ir) continue;
    const locate = locateWith(item.sources);
    for (const [index, instance] of item.ir.instances.entries()) {
      if (instance.uid === undefined) continue;
      if (declaredKeys.has(`${instance.uid}\u0000${instance.id}`)) continue;
      record(
        instance.uid,
        item.board,
        instance.id,
        locate?.(`/instances/${index}`) ?? { file: item.file, line: 1, col: 1 },
      );
    }
  }

  return diagnostics;
}
