// Reference renderer (AGENTS.md §1): IR → drawing commands → SVG.
// No KiCad dependency: previews belong to the design loop, KiCad only handles the manufacturing exit (ADR-0005).
export * from "./svg.ts";
export * from "./symbol.ts";
export * from "./footprint.ts";
