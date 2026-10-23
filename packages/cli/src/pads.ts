// Pad geometry for the copper-coverage check (ADR-0041 D4): the pad's shape is the footprint's,
// transformed by `place`. The description never carries pad geometry, and this module does not
// invent one.
//
// Footprints are read from the project's own library (`assets/footprints/<lib>/<id>.teda`). A
// footprint that is missing or does not compile yields no pads, and a check that cannot judge a
// pad stays silent about it rather than guessing (see `checkCopperCoverage`).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFootprint } from "@texteda/parser";
import type { Footprint } from "@texteda/ir/footprint";
import type { Schematic } from "@texteda/ir/schematic";
import type { Device, InstancePads } from "@texteda/core";
import { LAYOUT } from "./paths.ts";

/** The project's footprint library, keyed `lib:name` (the reference form used by components). */
export function loadFootprintLibrary(root: string): Map<string, Footprint> {
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
      if (!result.ir) continue;
      library.set(`${libEntry.name}:${entry.name.slice(0, -".teda".length)}`, result.ir);
    }
  }
  return library;
}

/**
 * Pad geometry of every instance of the schematic that has one.
 *
 * The radius is the **circumscribed** circle of the pad rect (half its diagonal): rotation
 * invariant, and never smaller than the copper — which is what makes the coverage check's
 * negative answer trustworthy (ADR-0041, `copper.ts` header).
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
