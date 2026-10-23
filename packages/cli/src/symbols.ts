// Symbol geometry for the drawing checks (spec/schematic-view.md §9.2): a wire's endpoint is a pin,
// and a readability finding is about where text and bodies actually land on the sheet.
//
// Symbols are read from the project's own library (`assets/symbols/<lib>/<id>.teda`), the same way
// footprints are (`pads.ts`). A symbol that is missing or does not compile yields no geometry, and a
// check that cannot judge a page stays silent about it rather than guessing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseSymbol } from "@texteda/parser";
import type { Symbol } from "@texteda/ir/symbol";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicInstance } from "@texteda/renderer";
import { LAYOUT } from "./paths.ts";

/** The project's symbol library, keyed `lib:name` (the reference form used by devices). */
export function loadSymbolLibrary(root: string): Map<string, Symbol> {
  const library = new Map<string, Symbol>();
  const base = join(root, LAYOUT.symbols);
  if (!existsSync(base)) return library;

  for (const libEntry of readdirSync(base, { withFileTypes: true })) {
    if (!libEntry.isDirectory()) continue;
    const libDir = join(base, libEntry.name);
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".teda")) continue;
      const file = join(libDir, entry.name);
      const result = parseSymbol(readFileSync(file, "utf8"), {
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
 * The board's instances as the renderer needs them: the symbol's geometry plus the device's pin
 * facts (ADR-0012: the symbol draws, the device names the pins).
 *
 * An instance whose device or symbol is unavailable is left out: the schematic parse already
 * reported the unknown device, and geometry cannot be invented for it.
 */
export function schematicInstances(
  schematic: Schematic,
  pinsOf: (componentId: string) => readonly { number: string; name: string; type: string }[],
  symbolOf: (componentId: string) => string | undefined,
  symbols: Map<string, Symbol>,
): Map<string, SchematicInstance> {
  const instances = new Map<string, SchematicInstance>();
  for (const instance of schematic.instances) {
    const symbolRef = symbolOf(instance.component);
    if (symbolRef === undefined) continue;
    const symbol = symbols.get(symbolRef);
    if (symbol === undefined) continue;
    instances.set(instance.id, {
      symbol: symbol.symbol,
      part: { pins: pinsOf(instance.component).map((pin) => ({ number: pin.number, name: pin.name, type: pin.type })) },
    });
  }
  return instances;
}
