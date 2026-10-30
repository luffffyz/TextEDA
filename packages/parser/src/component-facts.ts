// Extract from a `component` description **the few facts exporting a symbol needs**: the pin table, footprint, datasheet, description.
//
// This is a projection over the component parser (`component.ts`), not a second reader: the file is
// parsed once, with the part/generic rules enforced (ADR-0024, ADR-0024), and the exporter takes the fields
// it needs. Everything the parser does not read is still validated, because an invalid component
// file must not reach the exporter.
import type { Diagnostic } from "./diagnostics.ts";
import { parseComponent } from "./component.ts";

export interface ComponentPinFact {
  number: string;
  name: string;
  type: string;
}

export interface ComponentFacts {
  id: string;
  pins: ComponentPinFact[];
  footprint?: string;
  datasheet?: string;
  description?: string;
}

export interface ComponentFactsResult {
  ok: boolean;
  facts?: ComponentFacts;
  diagnostics: Diagnostic[];
}

export function readComponentFacts(text: string, options: { file: string }): ComponentFactsResult {
  const result = parseComponent(text, options);
  if (!result.ok || !result.component) {
    return { ok: false, diagnostics: result.diagnostics };
  }
  const component = result.component;
  const facts: ComponentFacts = {
    id: component.id,
    pins: component.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type })),
    ...(component.footprint ? { footprint: component.footprint } : {}),
    ...(component.datasheet ? { datasheet: component.datasheet } : {}),
    ...(component.description ? { description: component.description } : {}),
  };
  return { ok: true, facts, diagnostics: result.diagnostics };
}
