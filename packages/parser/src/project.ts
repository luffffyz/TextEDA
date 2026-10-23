// `project.toml` parsing: the project file → the project IR (AGENTS.md §9, "the keys project.toml allows").
//
// The project file carries **metadata**, never the circuit: the name and version, the board list,
// the variants, the library locks, the compliance targets. What a board is made of lives in
// `design/sch/`, and what is bought lives in `assets/procurement/`.
//
// Two levels, as everywhere else in this package:
//
//   - the document level reads the file on its own: the syntax, the keys, the shapes. It is what
//     the canonical formatter and the contract check need.
//   - the project level adds what only the project knows: whether a board id has a design file,
//     whether a default variant exists.
//
// The TOML subset is read by `toml.ts` — no dependency, and everything outside the subset is an
// error rather than a guess.
import { irVersion } from "@texteda/ir";
import type { Project } from "@texteda/ir/project";
import type { Diagnostic } from "@texteda/ir/diagnostics";
import { parseQuantityRange } from "./quantities.ts";
import { parseToml, subTable, tableValue, type TomlTable, type TomlValue } from "./toml.ts";

/** The keys of the `[project]` table. */
const PROJECT_KEYS = [
  "name",
  "version",
  "format",
  "description",
  "license",
  "status",
  "owner",
  "default_variant",
  "authors",
  "links",
] as const;

/** The keys of a `[boards.<id>]` table. */
const BOARD_KEYS = ["revision", "title"] as const;

/** The keys of a `[variants.<id>]` table. */
const VARIANT_KEYS = ["description", "dnp", "nofit", "alternates"] as const;

/** The keys of a `[libs.<name>]` table. */
const LIB_KEYS = [
  "source",
  "rev",
  "version",
  "path",
  "symbols",
  "footprints",
  "content_hash",
] as const;

/** The keys of the `[compliance]` table. */
const COMPLIANCE_KEYS = ["standards", "operating_temp"] as const;

/** The top-level tables the project file may contain. `[ext]` is the free-form area. */
const TOP_LEVEL_TABLES = ["project", "boards", "variants", "libs", "compliance", "ext"] as const;

const STATUS_VALUES = ["draft", "prototype", "frozen", "production", "deprecated"] as const;

export interface ProjectParseOptions {
  /** File name, relative to the project root. */
  file: string;
}

export interface ProjectParseResult {
  ok: boolean;
  ir?: Project;
  /**
   * The project's accountable person (`[project].owner`, ADR-0033 D5).
   *
   * Deliberately outside the IR: ownership is a fact about the project, not about the design,
   * so changing it must change no shard and no hash. The review check is its only consumer.
   */
  owner?: string;
  diagnostics: Diagnostic[];
}

function error(
  file: string,
  line: number,
  col: number,
  code: Diagnostic["code"],
  message: string,
): Diagnostic {
  return { severity: "error", code, message, location: { file, line, col } };
}

function asString(value: TomlValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: TomlValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    out.push(item);
  }
  return out;
}

/** The line a top-level table starts on, used to point at the offending key. */
function tableLine(root: TomlTable, path: string[]): number {
  let current: TomlTable | undefined = root;
  let line = 1;
  for (const part of path) {
    const value: TomlValue | TomlTable | TomlTable[] | undefined = current?.[part];
    if (value === undefined) break;
    if (Array.isArray(value)) {
      const last: TomlValue | TomlTable | undefined = value[value.length - 1];
      if (last && typeof last === "object" && !Array.isArray(last)) current = last;
      else break;
      continue;
    }
    if (typeof value === "object") current = value;
    else break;
    line += 1;
  }
  return line;
}

/** Report a key that the file may not contain. */
function rejectUnknownKeys(
  table: TomlTable,
  allowed: readonly string[],
  where: string,
  file: string,
  line: number,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(table)) {
    if (allowed.includes(key)) continue;
    diagnostics.push(
      error(file, line, 1, "syntax.unknown-field", `unknown key \`${key}\` in ${where}`),
    );
  }
}

/** Read a project file. */
export function parseProjectToml(source: string, options: ProjectParseOptions): ProjectParseResult {
  const file = options.file;
  const diagnostics: Diagnostic[] = [];
  const toml = parseToml(source, { file });
  diagnostics.push(...toml.diagnostics);
  if (!toml.value) return { ok: false, diagnostics };
  const root = toml.value;

  // The top level: only the known tables, and `[ext]` for everything else.
  for (const key of Object.keys(root)) {
    if ((TOP_LEVEL_TABLES as readonly string[]).includes(key)) continue;
    diagnostics.push(
      error(file, 1, 1, "syntax.unknown-field", `unknown top-level table \`${key}\``),
    );
  }

  const projectTable = subTable(root, "project");
  if (!projectTable) {
    diagnostics.push(
      error(file, 1, 1, "syntax.header-invalid", "the project file has no `[project]` table"),
    );
    return { ok: false, diagnostics };
  }
  rejectUnknownKeys(projectTable, PROJECT_KEYS, "`[project]`", file, 1, diagnostics);

  const ownerRaw = tableValue(projectTable, "owner");
  const owner = asString(ownerRaw);
  if (ownerRaw !== undefined && owner === undefined) {
    diagnostics.push(error(file, 1, 1, "value.project-owner-invalid", "`[project].owner` must be a string (the accountable person, ADR-0033 D5)"));
  }

  const name = asString(tableValue(projectTable, "name"));
  const version = asString(tableValue(projectTable, "version"));
  const format = asString(tableValue(projectTable, "format"));
  if (name === undefined) {
    diagnostics.push(error(file, 1, 1, "syntax.unknown-field", "`[project]` needs a `name`"));
  }
  if (version === undefined) {
    diagnostics.push(error(file, 1, 1, "syntax.unknown-field", "`[project]` needs a `version`"));
  }
  if (format === undefined) {
    diagnostics.push(error(file, 1, 1, "syntax.unknown-field", "`[project]` needs a `format`"));
  }
  if (name !== undefined && !/^[A-Za-z0-9_.-]+$/.test(name)) {
    diagnostics.push(
      error(file, 1, 1, "value.project-name-invalid", `the project name \`${name}\` has characters a name may not have`),
    );
  }
  if (version !== undefined && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
    diagnostics.push(
      error(file, 1, 1, "value.project-version-invalid", `the project version \`${version}\` must be written as major.minor.patch`),
    );
  }

  const status = asString(tableValue(projectTable, "status"));
  if (status !== undefined && !(STATUS_VALUES as readonly string[]).includes(status)) {
    diagnostics.push(
      error(file, 1, 1, "value.project-status-invalid", `unknown project status \`${status}\``),
    );
  }

  // The authors: an array of tables.
  const authorsRaw = projectTable["authors"];
  const authors: { name: string; email?: string }[] = [];
  if (authorsRaw !== undefined) {
    if (!Array.isArray(authorsRaw)) {
      diagnostics.push(
        error(file, 1, 1, "value.project-authors-invalid", "`project.authors` must be a list of `[[project.authors]]` tables"),
      );
    } else {
      for (const entry of authorsRaw) {
        if (typeof entry !== "object" || Array.isArray(entry)) {
          diagnostics.push(
            error(file, 1, 1, "value.project-authors-invalid", "`project.authors` must be a list of `[[project.authors]]` tables"),
          );
          break;
        }
        const authorName = asString(tableValue(entry as TomlTable, "name"));
        if (authorName === undefined) {
          diagnostics.push(
            error(file, 1, 1, "value.project-authors-invalid", "an author needs a `name`"),
          );
          break;
        }
        const email = asString(tableValue(entry as TomlTable, "email"));
        authors.push(email === undefined ? { name: authorName } : { name: authorName, email });
      }
    }
  }

  // The links.
  const linksTable = subTable(projectTable, "links");
  const links: { repository?: string; homepage?: string; issues?: string } = {};
  if (linksTable) {
    rejectUnknownKeys(linksTable, ["repository", "homepage", "issues"], "`[project.links]`", file, 1, diagnostics);
    for (const key of ["repository", "homepage", "issues"] as const) {
      const value = asString(tableValue(linksTable, key));
      if (value !== undefined) links[key] = value;
    }
  }

  // The boards.
  const boardsTable = subTable(root, "boards");
  const boards: { id: string; revision?: string; title?: string }[] = [];
  if (boardsTable) {
    for (const id of Object.keys(boardsTable)) {
      const value = boardsTable[id];
      if (typeof value !== "object" || Array.isArray(value)) {
        diagnostics.push(
          error(file, tableLine(root, ["boards", id]), 1, "value.project-board-invalid", `\`[boards.${id}]\` must be a table`),
        );
        continue;
      }
      const board = value as TomlTable;
      rejectUnknownKeys(board, BOARD_KEYS, `\`[boards.${id}]\``, file, tableLine(root, ["boards", id]), diagnostics);
      const entry: { id: string; revision?: string; title?: string } = { id };
      const revision = asString(tableValue(board, "revision"));
      const title = asString(tableValue(board, "title"));
      if (revision !== undefined) entry.revision = revision;
      if (title !== undefined) entry.title = title;
      boards.push(entry);
    }
    boards.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // The variants.
  const variantsTable = subTable(root, "variants");
  const variants: {
    id: string;
    description?: string;
    dnp?: string[];
    nofit?: string[];
    alternates?: { from: string; to: string }[];
  }[] = [];
  if (variantsTable) {
    for (const id of Object.keys(variantsTable)) {
      const value = variantsTable[id];
      if (typeof value !== "object" || Array.isArray(value)) {
        diagnostics.push(
          error(file, tableLine(root, ["variants", id]), 1, "value.project-variant-invalid", `\`[variants.${id}]\` must be a table`),
        );
        continue;
      }
      const variant = value as TomlTable;
      rejectUnknownKeys(variant, VARIANT_KEYS, `\`[variants.${id}]\``, file, tableLine(root, ["variants", id]), diagnostics);
      const entry: {
        id: string;
        description?: string;
        dnp?: string[];
        nofit?: string[];
        alternates?: { from: string; to: string }[];
      } = { id };
      const description = asString(tableValue(variant, "description"));
      if (description !== undefined) entry.description = description;
      const dnp = asStringArray(tableValue(variant, "dnp"));
      const nofit = asStringArray(tableValue(variant, "nofit"));
      if (dnp !== undefined) entry.dnp = dnp;
      if (nofit !== undefined) entry.nofit = nofit;
      const alternatesRaw = tableValue(variant, "alternates");
      if (alternatesRaw !== undefined) {
        if (!Array.isArray(alternatesRaw)) {
          diagnostics.push(
            error(file, tableLine(root, ["variants", id]), 1, "value.project-variant-invalid", "`alternates` must be a list of { from, to } tables"),
          );
        } else {
          const alternates: { from: string; to: string }[] = [];
          for (const item of alternatesRaw) {
            if (typeof item !== "object" || Array.isArray(item)) {
              diagnostics.push(
                error(file, tableLine(root, ["variants", id]), 1, "value.project-variant-invalid", "`alternates` must be a list of { from, to } tables"),
              );
              break;
            }
            const from = asString(tableValue(item as TomlTable, "from"));
            const to = asString(tableValue(item as TomlTable, "to"));
            if (from === undefined || to === undefined) {
              diagnostics.push(
                error(file, tableLine(root, ["variants", id]), 1, "value.project-variant-invalid", "an alternate needs a `from` and a `to`"),
              );
              break;
            }
            alternates.push({ from, to });
          }
          entry.alternates = alternates;
        }
      }
      variants.push(entry);
    }
    variants.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  const defaultVariant = asString(tableValue(projectTable, "default_variant"));
  if (defaultVariant !== undefined && !variants.some((variant) => variant.id === defaultVariant)) {
    diagnostics.push(
      error(file, 1, 1, "ref.unknown-variant", `the default variant \`${defaultVariant}\` is not defined`),
    );
  }

  // The library locks.
  const libsTable = subTable(root, "libs");
  const libs: {
    id: string;
    source: string;
    rev?: string;
    version?: string;
    path?: string;
    symbols?: string;
    footprints?: string;
    content_hash?: string;
  }[] = [];
  if (libsTable) {
    for (const id of Object.keys(libsTable)) {
      const value = libsTable[id];
      if (typeof value !== "object" || Array.isArray(value)) {
        diagnostics.push(
          error(file, tableLine(root, ["libs", id]), 1, "value.project-lib-invalid", `\`[libs.${id}]\` must be a table`),
        );
        continue;
      }
      const lib = value as TomlTable;
      rejectUnknownKeys(lib, LIB_KEYS, `\`[libs.${id}]\``, file, tableLine(root, ["libs", id]), diagnostics);
      const source = asString(tableValue(lib, "source"));
      if (source === undefined) {
        diagnostics.push(
          error(file, tableLine(root, ["libs", id]), 1, "value.project-lib-invalid", `\`[libs.${id}]\` needs a \`source\``),
        );
        continue;
      }
      const entry: {
        id: string;
        source: string;
        rev?: string;
        version?: string;
        path?: string;
        symbols?: string;
        footprints?: string;
        content_hash?: string;
      } = { id, source };
      for (const key of ["rev", "version", "path", "symbols", "footprints", "content_hash"] as const) {
        const value2 = asString(tableValue(lib, key));
        if (value2 !== undefined) entry[key] = value2;
      }
      if (entry.rev === undefined && entry.version === undefined && entry.content_hash === undefined) {
        diagnostics.push(
          error(file, tableLine(root, ["libs", id]), 1, "value.project-lib-invalid", `\`[libs.${id}]\` needs one of \`rev\`, \`version\` or \`content_hash\` so the library is pinned`),
        );
      }
      libs.push(entry);
    }
    libs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // The compliance targets.
  const complianceTable = subTable(root, "compliance");
  const compliance: { standards?: string[]; operating_temp?: { min_mdegc: number; max_mdegc: number } } = {};
  if (complianceTable) {
    rejectUnknownKeys(complianceTable, COMPLIANCE_KEYS, "`[compliance]`", file, tableLine(root, ["compliance"]), diagnostics);
    const standards = asStringArray(tableValue(complianceTable, "standards"));
    if (standards !== undefined) compliance.standards = standards;
    const operatingTemp = asString(tableValue(complianceTable, "operating_temp"));
    if (operatingTemp !== undefined) {
      const range = parseQuantityRange(operatingTemp, "temperature", {
        code: "value.project-operating-temp-invalid",
      });
      if (!range.ok) {
        diagnostics.push(
          error(file, tableLine(root, ["compliance"]), 1, "value.project-operating-temp-invalid", range.reason),
        );
      } else {
        compliance.operating_temp = { min_mdegc: range.min, max_mdegc: range.max };
      }
    }
  }

  // The free-form area is kept as it is written.
  const extTable = subTable(root, "ext");
  const ext = extTable ? ({ ...extTable } as Record<string, unknown>) : undefined;

  if (diagnostics.length > 0) return { ok: false, ...(owner !== undefined ? { owner } : {}), diagnostics };

  const ir: Project = {
    ir_version: irVersion,
    project: {
      name: name!,
      version: version!,
      format: format!,
      ...(asString(tableValue(projectTable, "description")) !== undefined
        ? { description: asString(tableValue(projectTable, "description"))! }
        : {}),
      ...(status !== undefined ? { status: status as NonNullable<Project["project"]["status"]> } : {}),
      ...(defaultVariant !== undefined ? { default_variant: defaultVariant } : {}),
      ...(authors.length > 0
        ? { authors: authors as [{ name: string; email?: string }, ...{ name: string; email?: string }[]] }
        : {}),
      ...(Object.keys(links).length > 0 ? { links } : {}),
    },
    ...(boards.length > 0 ? { boards } : {}),
    ...(variants.length > 0 ? { variants } : {}),
    ...(libs.length > 0 ? { libs } : {}),
    ...(Object.keys(compliance).length > 0 ? { compliance } : {}),
    ...(ext !== undefined ? { ext } : {}),
  };
  return { ok: true, ir, ...(owner !== undefined ? { owner } : {}), diagnostics };
}
