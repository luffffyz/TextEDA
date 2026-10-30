// Pad geometry for the copper-coverage check (ADR-0020 D4): the pad's shape is the footprint's,
// transformed by `place`. The description never carries pad geometry, and this module does not
// invent one.
//
// Footprints are read from the project's classification tree
// (`assets/footprints/<family>/<id>.teda`, ADR-0049), the only place geometry lives: an imported
// library is copied here (ADR-0034). A footprint that is
// missing yields no pads, and a check that cannot judge a pad stays silent about it rather than
// guessing (see `checkCopperCoverage`). A footprint that does not compile, or whose IR does not
// satisfy the contract, is reported: `ir` refuses to write that shard, and `check` must not go green
// while the build is red (ADR-0038 decision 7).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFootprint } from "@texteda/parser";
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Footprint } from "@texteda/ir/footprint";
import type { Schematic } from "@texteda/ir/schematic";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import type { Device, InstancePads } from "@texteda/core";
import { LAYOUT } from "./paths.ts";
import { locateWith } from "./locate.ts";

/**
 * The project's footprints, keyed `<family>:<name>` (the reference form components use): the key of
 * a file is the classification directory it sits in, not a library it belongs to (ADR-0049).
 *
 * `diagnostics` collects what the files had to say (parse and contract); a file that fails is left
 * out of the set, exactly as the shard tree leaves it out of the build.
 */
export function loadFootprintLibrary(root: string, diagnostics: Diagnostic[] = []): Map<string, Footprint> {
  const library = new Map<string, Footprint>();
  const base = join(root, LAYOUT.footprints);
  if (!existsSync(base)) return library;

  for (const libEntry of readdirSync(base, { withFileTypes: true })) {
    if (!libEntry.isDirectory()) continue;
    const libDir = join(base, libEntry.name);
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".teda")) continue;
      const file = join(libDir, entry.name);
      const result = parseFootprint(readFileSync(file, "utf8"), {
        file: relative(root, file),
        library: libEntry.name,
      });
      diagnostics.push(...result.diagnostics);
      if (!result.ir) continue;
      const contract = validate("footprint", result.ir);
      if (!contract.ok) {
        diagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(result.sources)));
        continue;
      }
      library.set(`${libEntry.name}:${entry.name.slice(0, -".teda".length)}`, result.ir);
    }
  }

  return library;
}

/**
 * Each device with the package code of its land pattern attached (ADR-0028 decision 1).
 *
 * The package floor (ADR-0027) is keyed by `(construction, package_code)`, and neither is in the
 * device file: the construction is the generic's, the code is the land pattern's. This is the one
 * place that holds both, so the checks that need the floor get it from here.
 * A device whose footprint does not compile keeps no code: an unknown package is counted as
 * "not compared", never as a pass.
 */
export function withPackageCodes(
  devices: ReadonlyMap<string, Device>,
  library: Map<string, Footprint>,
): Map<string, Device> {
  const out = new Map<string, Device>();
  for (const [id, device] of devices) {
    const code = library.get(device.footprint)?.footprint.package_code;
    out.set(id, code === undefined ? device : { ...device, package_code: code });
  }
  return out;
}

/**
 * Pad geometry of every instance of the schematic that has one.
 *
 * The radius is the **circumscribed** circle of the pad rect (half its diagonal): rotation
 * invariant, and never smaller than the copper — which is what makes the coverage check's
 * negative answer trustworthy (ADR-0020, `copper.ts` header).
 */
export function padsByInstance(
  schematic: Schematic,
  devices: Map<string, Device>,
  library: Map<string, Footprint>,
): InstancePads[] {
  const out: InstancePads[] = [];
  for (const instance of schematic.instances) {
    const footprintRef = devices.get(instance.component)?.footprint;
    if (footprintRef === undefined) continue;
    const footprint = library.get(footprintRef);
    if (footprint === undefined) continue;
    out.push({
      instance_id: instance.id,
      pads: footprint.footprint.pads.map((pad) => ({
        number: pad.number,
        x_nm: pad.at.x_nm,
        y_nm: pad.at.y_nm,
        radius_nm: Math.hypot(pad.size.x_nm / 2, pad.size.y_nm / 2),
        layers: pad.layers,
      })),
    });
  }
  return out;
}

/**
 * Every placed instance's whole footprint, for the rules that need pad *shape* rather than a radius.
 *
 * The copper fill is one of them: a pour has to keep its clearance from the pad's real outline, and a
 * circumscribed circle would carve a bigger hole than the copper (ADR-0018 D3). Placement is the
 * caller's: a footprint that the pcb does not place contributes nothing (partial layout, ADR-0019).
 */
export function footprintsByInstance(
  schematic: Schematic,
  devices: Map<string, Device>,
  library: Map<string, Footprint>,
): { instance_id: string; footprint: Footprint }[] {
  const out: { instance_id: string; footprint: Footprint }[] = [];
  for (const instance of schematic.instances) {
    const ref = devices.get(instance.component)?.footprint;
    if (ref === undefined) continue;
    const footprint = library.get(ref);
    if (footprint === undefined) continue;
    out.push({ instance_id: instance.id, footprint });
  }
  return out;
}
