// The review app's definition menu, separated from the DOM: which source locations belong to a
// selected identity, and how a location becomes an editor URI (ADR-0004 D6, ADR-0035 2026-10-26).
import type {
  ReviewInstance,
  ReviewSourceLocation,
  ReviewSources,
} from "./types.ts";

export interface DefinitionQuery {
  sources: ReviewSources;
  board: string;
  selected: { kind: "symbol" | "text"; id: string };
  /** The selected instance, when the drawing placed one. */
  instance?: ReviewInstance;
  /** Pin numbers the current page draws for the selected instance. */
  pins?: readonly string[];
}

/**
 * Every place the selected identity appears: its own key, then the device files and the pin rows
 * the drawing can show. A net has only its own key; a component pin is not selectable on its own.
 */
export function definitionLocations(query: DefinitionQuery): ReviewSourceLocation[] {
  const key =
    query.selected.kind === "symbol"
      ? `instance:${query.board}/${query.selected.id}`
      : `net:${query.board}/${query.selected.id}`;
  const locations = [...(query.sources[key] ?? [])];
  if (query.selected.kind !== "symbol" || query.instance === undefined) {
    return uniqueLocations(locations);
  }

  const instance = query.instance;
  for (const extraKey of [
    `component:${instance.component}`,
    instance.symbol === undefined ? undefined : `symbol:${instance.symbol}`,
    instance.footprint === undefined ? undefined : `footprint:${instance.footprint}`,
  ]) {
    if (extraKey !== undefined) locations.push(...(query.sources[extraKey] ?? []));
  }
  for (const pin of query.pins ?? []) {
    locations.push(...(query.sources[`component-pin:${instance.component}/${pin}`] ?? []));
  }
  return uniqueLocations(locations);
}

/** A source location as the editor URI `vscode://file/<absolute>:<line>:<col>`. */
export function editorUri(root: string, location: ReviewSourceLocation): string {
  const normalizedRoot = root.replace(/\/+$/, "");
  const absolute = location.file.startsWith("/") ? location.file : `${normalizedRoot}/${location.file}`;
  // The authority is `file`; the absolute path is the URI path. Encode segment by segment so
  // spaces and `#` in a filename survive.
  const path = absolute.split("/").map(encodeURIComponent).join("/");
  const uriPath = path.startsWith("/") ? path : `/${path}`;
  return `vscode://file${uriPath}:${location.line}:${location.col}`;
}

function uniqueLocations(locations: readonly ReviewSourceLocation[]): ReviewSourceLocation[] {
  const seen = new Set<string>();
  const unique: ReviewSourceLocation[] = [];
  for (const location of locations) {
    const key = `${location.kind}\u0000${location.label}\u0000${location.file}\u0000${location.line}\u0000${location.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(location);
  }
  return unique;
}
