// Symbol geometry for the drawing checks (spec/schematic-view.md §9.2): a wire's endpoint is a pin,
// and a readability finding is about where text and bodies actually land on the sheet.
//
// Symbols are read from the project's own library (`assets/symbols/<lib>/<id>.teda`), the same way
// footprints are (`pads.ts`). A symbol that is missing yields no geometry, and a check that cannot
// judge a page stays silent about it rather than guessing. A symbol that does not compile, or whose
// IR does not satisfy the contract, is reported: `ir` refuses to write that shard, and `check` must
// not go green while the build is red (ADR-0038 decision 7).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { QUANTITY_SPECS, formatQuantity, parseSymbol, type QuantityKind } from "@texteda/parser";
import { schemaDiagnosticsToDiagnostics, validate } from "@texteda/ir";
import type { Symbol } from "@texteda/ir/symbol";
import type { Schematic } from "@texteda/ir/schematic";
import type { SchematicInstance } from "@texteda/renderer";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { LAYOUT } from "./paths.ts";
import { locateWith } from "./locate.ts";

/**
 * The project's symbol library, keyed `lib:name` (the reference form used by devices).
 *
 * `diagnostics` collects what the files had to say (parse and contract); a file that fails is left
 * out of the library, exactly as the shard tree leaves it out of the build.
 */
export function loadSymbolLibrary(root: string, diagnostics: Diagnostic[] = []): Map<string, Symbol> {
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
      diagnostics.push(...result.diagnostics);
      if (!result.ir) continue;
      const contract = validate("symbol", result.ir);
      if (!contract.ok) {
        diagnostics.push(...schemaDiagnosticsToDiagnostics(contract.errors, locateWith(result.sources)));
        continue;
      }
      library.set(`${libEntry.name}:${entry.name.slice(0, -".teda".length)}`, result.ir);
    }
  }

  return library;
}

/** A board's instances as the renderer needs them, keyed by instance id. */
export type SchematicInstances = Map<string, SchematicInstance>;

/**
 * The board's instances as the renderer needs them: the symbol's geometry plus the device's pin
 * facts (ADR-0031: the symbol draws, the device names the pins).
 *
 * An instance whose device or symbol is unavailable is left out: the schematic parse already
 * reported the unknown device, and geometry cannot be invented for it.
 */
export function schematicInstances(
  schematic: Schematic,
  pinsOf: (componentId: string) => readonly { number: string; name: string; type: string }[],
  symbolOf: (componentId: string) => string | undefined,
  symbols: Map<string, Symbol>,
  deviceOf: (componentId: string) => DeviceFacts | undefined = () => undefined,
): SchematicInstances {
  const instances = new Map<string, SchematicInstance>();
  for (const instance of schematic.instances) {
    const symbolRef = symbolOf(instance.component);
    if (symbolRef === undefined) continue;
    const symbol = symbols.get(symbolRef);
    if (symbol === undefined) continue;
    const value = instanceValueText(instance, deviceOf(instance.component));
    instances.set(instance.id, {
      symbol: symbol.symbol,
      part: { pins: pinsOf(instance.component).map((pin) => ({ number: pin.number, name: pin.name, type: pin.type })) },
      ...(value === undefined ? {} : { value }),
    });
  }
  return instances;
}

/** What the drawing needs to know about a device: its parameter columns and, for a part, its MPN. */
export interface DeviceFacts {
  readonly params: readonly { name: string; type: string }[];
  readonly mpn?: string;
}

/**
 * The instance's value as the page prints it (`10k`, `100nF`), or nothing.
 *
 * The symbol's `Value` field is a library placeholder, because a generic device's file cannot hold
 * a value (ADR-0024: values live on the instance row). The column is a canonical integer whose unit
 * comes from the device's declaration, so it is formatted with the same formatter the language uses
 * to write a quantity (ADR-0006 decision 7); a text column is printed as written.
 *
 * The drawing's font is ASCII-only, so a unit symbol it cannot draw is left out rather than printed
 * as a missing glyph: `10kΩ` reads `10k` (the SI prefix carries the magnitude), while `100nF` and
 * `15uH` keep their unit.
 */
export function instanceValueText(
  instance: Schematic["instances"][number],
  device: DeviceFacts | undefined,
): string | undefined {
  const column = (instance.params ?? []).find((param) => param.name === "value");
  if (column === undefined) {
    // A part has no value column: its value *is* its MPN (a generic device has one, a part does not).
    return device?.mpn === undefined ? undefined : drawable(device.mpn);
  }
  if ("text" in column) return drawable(column.text);
  const type = device?.params.find((param) => param.name === "value")?.type;
  if (type === undefined || !(type in QUANTITY_SPECS)) return drawable(String(column.value));
  return drawable(formatQuantity(column.value, type as QuantityKind));
}

/** Drop characters the built-in stroke font cannot draw (it covers printable ASCII only). */
function drawable(text: string): string {
  return text.replace(/[^ -~]/g, "");
}
