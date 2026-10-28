// Library curation: is every device file used by the project?
//
// A device file is content of the project, not just a build input: it becomes a shard, and the
// project hash covers it (ADR-0105). That is the right shape for an IR — a file with no shard
// would be indistinguishable from a file that does not exist — but it also means an abandoned
// candidate is invisible: it sits in `assets/components/`, changes the project hash, and nobody
// notices. With more than one author that is how a library turns into a dumping ground.
//
// So the rule is not "delete every candidate" (a part bought for a revision that has not been
// drawn yet is legitimate, and the procurement layer names second sources before a board needs
// them): it is "say it out loud". The same policy the procurement layer already applies to a
// selection that names a line the design does not use (`value.procurement-part-unused`, a
// warning).
//
// Pure: the ids in, the diagnostics out.
import type { Diagnostic } from "@texteda/ir/diagnostics";

export interface DeviceUsageFacts {
  /** Every device file in the library, in file order, with where it lives. */
  readonly devices: readonly { readonly id: string; readonly file: string }[];
  /** Ids that a board places, or that a procurement file names (as a generic or as a part). */
  readonly referenced: ReadonlySet<string>;
}

/**
 * One warning per device file that nothing places and nothing selects.
 *
 * The location is line 2: the `component <id>` header, which is the name the message is about.
 */
export function checkDeviceUsage(facts: DeviceUsageFacts): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const device of facts.devices) {
    if (facts.referenced.has(device.id)) continue;
    diagnostics.push({
      code: "library.device-unused",
      severity: "warning",
      message: `device ${device.id} is not placed by any board and not selected by any procurement file`,
      hint: "place it on a board, select it in a procurement file, or delete the file: the library is part of the project identity, so an abandoned candidate still changes the project hash",
      location: { file: device.file, line: 2, col: 1 },
      data: { component: device.id },
    });
  }
  return diagnostics;
}
