import ts from "typescript";
import { existsSync, mkdirSync, realpathSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  name?: unknown;
  exports?: unknown;
}

interface PackageExport {
  packageName: string;
  packageDirectory: string;
  importPath: string;
  sourceFile: string;
}

interface ResolvedExport extends PackageExport {
  source: ts.SourceFile;
  symbols: ts.Symbol[];
  checker: ts.TypeChecker;
}

function conditionPriority(condition: string): number {
  if (condition === "types") return 0;
  if (condition === "import") return 1;
  if (condition === "default") return 2;
  return 3;
}

function stringTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringTargets);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value)
    .sort(([left], [right]) => {
      const priorityDifference = conditionPriority(left) - conditionPriority(right);
      if (priorityDifference !== 0) return priorityDifference;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .flatMap(([, target]) => stringTargets(target));
}

function packageExports(value: unknown): Array<[string, unknown]> {
  if (typeof value === "string" || Array.isArray(value)) return [[".", value]];
  if (typeof value !== "object" || value === null) return [];
  const entries = Object.entries(value);
  const subpaths = entries.filter(([key]) => key.startsWith("."));
  return subpaths.length > 0 ? subpaths : [[".", value]];
}

function resolveSourceTarget(packageDirectory: string, packageName: string, subpath: string, target: unknown): string {
  const candidates = [...new Set(stringTargets(target))]
    .filter((candidate) => {
      const extension = extname(candidate);
      return extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts";
    })
    .map((candidate) => resolve(packageDirectory, candidate));
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (!existing) {
    throw new Error(
      `${packageName} export ${subpath} must resolve to an existing local TypeScript source or declaration file`,
    );
  }
  const packageRelative = relative(packageDirectory, existing);
  if (packageRelative === ".." || packageRelative.startsWith(`..${sep}`)) {
    throw new Error(`${packageName} export ${subpath} resolves outside its package directory`);
  }
  return existing;
}

function readPackageExports(root: string): PackageExport[] {
  const packageRoot = join(root, "packages");
  const packageDirectories = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const exports: PackageExport[] = [];

  for (const directory of packageDirectories) {
    const packageDirectory = join(packageRoot, directory);
    const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8")) as PackageManifest;
    if (typeof manifest.name !== "string" || manifest.exports === undefined) continue;

    const entries = packageExports(manifest.exports);
    if (entries.length === 0) throw new Error(`${directory}/package.json has an unreadable exports map`);

    for (const [subpath, target] of entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
      if (subpath.includes("*")) throw new Error(`${manifest.name} has an unsupported wildcard export: ${subpath}`);
      exports.push({
        packageName: manifest.name,
        packageDirectory,
        importPath: subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`,
        sourceFile: resolveSourceTarget(packageDirectory, manifest.name, subpath, target),
      });
  }
  }

  return exports.sort((left, right) => {
    const leftKey = `${left.packageName}/${left.importPath}`;
    const rightKey = `${right.packageName}/${right.importPath}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = join(root, "tsconfig.base.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const converted = ts.convertCompilerOptionsFromJson(config.config.compilerOptions ?? {}, root);
  if (converted.errors.length > 0) {
    throw new Error(converted.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"));
  }
  return { ...converted.options, noEmit: true };
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
  return checker.getAliasedSymbol(symbol);
}

function exportKind(symbol: ts.Symbol): string {
  const flags = symbol.flags;
  if (flags & ts.SymbolFlags.Function) return "function";
  if (flags & ts.SymbolFlags.Class) return "class";
  if (flags & ts.SymbolFlags.Interface) return "interface";
  if (flags & ts.SymbolFlags.TypeAlias) return "type";
  if (flags & ts.SymbolFlags.Enum) return "enum";
  if (flags & ts.SymbolFlags.Module) return "namespace";
  if (flags & ts.SymbolFlags.Method) return "method";
  if (flags & ts.SymbolFlags.Variable) return "value";
  return "export";
}

function exportSignatures(checker: ts.TypeChecker, symbol: ts.Symbol, location: ts.Node): string[] {
  const kind = exportKind(symbol);
  if (kind !== "function" && kind !== "method" && kind !== "value") return [];
  const type = checker.getTypeOfSymbolAtLocation(symbol, location);
  return checker.getSignaturesOfType(type, ts.SignatureKind.Call).map((signature) =>
    checker.signatureToString(signature, location, ts.TypeFormatFlags.None).replace(/\s+/g, " ").trim(),
  );
}
function exportType(checker: ts.TypeChecker, symbol: ts.Symbol, location: ts.Node): string {
  const signatures = exportSignatures(checker, symbol, location);
  if (signatures.length > 0) return signatures.join(" | ");

  const declared =
    symbol.flags &
    (ts.SymbolFlags.Class | ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum)
      ? checker.getDeclaredTypeOfSymbol(symbol)
      : checker.getTypeOfSymbolAtLocation(symbol, location);
  return firstLine(checker.typeToString(declared, location).replace(/\s+/g, " ").trim());
}

function normalizeSummary(text: string): string {
  return text.replace(/(^|[^A-Za-z0-9_\/])teda\.md §/g, "$1spec/teda.md §");
}

function firstLine(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replace(/[\r\n]+/g, " ");
}

function repoRelativePath(root: string, fileName: string): string | null {
  const absolute = realpathSync(resolve(fileName));
  const path = relative(root, absolute);
  if (path === ".." || path.startsWith(`..${sep}`)) return null;
  return path.split(sep).join("/");
}

function declarationLocation(
  root: string,
  exported: ts.Symbol,
  resolved: ts.Symbol,
  fallback: ts.SourceFile,
): { path: string; line: number; declaration: ts.Node } {
  const declarations = [...(resolved.getDeclarations() ?? []), ...(exported.getDeclarations() ?? [])];
  for (const declaration of declarations) {
    const source = declaration.getSourceFile();
    const path = repoRelativePath(root, source.fileName);
    if (path !== null) {
      return {
        path,
        line: source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1,
        declaration,
      };
    }
  }

  const path = repoRelativePath(root, fallback.fileName);
  if (path === null) throw new Error(`public export source is outside the repository: ${fallback.fileName}`);
  const declaration = exported.getDeclarations()?.find((candidate) => candidate.getSourceFile() === fallback) ?? fallback;
  return {
    path,
    line: fallback.getLineAndCharacterOfPosition(declaration.getStart(fallback)).line + 1,
    declaration,
  };
}

function collectExports(root: string): ResolvedExport[] {
  const packageExportsToRead = readPackageExports(root);
  const program = ts.createProgram({
    rootNames: [...new Set(packageExportsToRead.map((entry) => entry.sourceFile))],
    options: compilerOptions(root),
  });
  const checker = program.getTypeChecker();

  return packageExportsToRead.map((entry) => {
    const source = program.getSourceFile(entry.sourceFile);
    if (!source) throw new Error(`TypeScript could not load export target ${entry.sourceFile}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`TypeScript could not inspect export target ${entry.sourceFile}`);
    return { ...entry, source, symbols: checker.getExportsOfModule(moduleSymbol), checker };
  });
}

function codeCell(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

interface ApiReferenceDocument {
  path: string;
  content: string;
}

interface PackageGroup {
  packageName: string;
  packageDirectory: string;
  entries: ResolvedExport[];
}

function packageGroups(entries: ResolvedExport[]): PackageGroup[] {
  const groups = new Map<string, PackageGroup>();
  for (const entry of entries) {
    const group = groups.get(entry.packageDirectory);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(entry.packageDirectory, {
        packageName: entry.packageName,
        packageDirectory: entry.packageDirectory,
        entries: [entry],
      });
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.packageName < right.packageName ? -1 : left.packageName > right.packageName ? 1 : 0,
  );
}

function apiPagePath(root: string, group: PackageGroup): string {
  const packageDirectory = relative(join(root, "packages"), group.packageDirectory);
  if (packageDirectory === ".." || packageDirectory.startsWith(`..${sep}`) || packageDirectory.includes(sep)) {
    throw new Error(`package export directory must be a direct child of packages/: ${group.packageDirectory}`);
  }
  return `packages/${packageDirectory}.md`;
}

function markdownHref(root: string, fromDocument: string, targetRepositoryPath: string): string {
  const fromPath = join(root, "docs", "api-reference", fromDocument);
  return relative(dirname(fromPath), join(root, targetRepositoryPath)).split(sep).join("/");
}

function packageExportRows(entry: ResolvedExport): Array<{ exported: ts.Symbol; resolved: ts.Symbol }> {
  return entry.symbols
    .map((exported) => ({ exported, resolved: resolveAlias(entry.checker, exported) }))
    .sort((left, right) => {
      const leftName = left.exported.getName();
      const rightName = right.exported.getName();
      return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
    });
}

function renderExportTable(root: string, pagePath: string, entry: ResolvedExport): string[] {
  const lines = ["| Export | Kind | Signature / type | Summary | Declaration |", "|---|---|---|---|---|"];
  for (const { exported, resolved } of packageExportRows(entry)) {
    const location = declarationLocation(root, exported, resolved, entry.source);
    const signature = exportType(entry.checker, resolved, location.declaration);
    const summary = firstLine(
      normalizeSummary(
        ts.displayPartsToString(resolved.getDocumentationComment(entry.checker)) ||
          ts.displayPartsToString(exported.getDocumentationComment(entry.checker)),
      ),
    );
    const href = markdownHref(root, pagePath, location.path);
    lines.push(
      `| ${codeCell(exported.getName())} | ${exportKind(resolved)} | ${signature ? codeCell(signature) : "—"} | ${summary ? escapeHtml(summary) : "—"} | [${location.path}#L${location.line}](${href}#L${location.line}) |`,
    );
  }
  return lines;
}

function renderPackagePage(root: string, group: PackageGroup): string {
  const pagePath = apiPagePath(root, group);
  const lines = [
    `# ${codeCell(group.packageName)}`,
    "",
    `[Back to the API reference index](${markdownHref(root, pagePath, "docs/api-reference/README.md")}).`,
    "",
    "> Generated by `bun run gen` from this package's `exports` map and the TypeScript Compiler API; do not edit by hand.",
    "",
    "Public exports for this workspace package. This is implementation navigation, not a semantic contract or compatibility promise.",
    "",
    "## Public entry points",
    "",
    "| Import path | Source | Named exports |",
    "|---|---|---:|",
  ];

  for (const entry of group.entries) {
    const sourcePath = repoRelativePath(root, entry.sourceFile);
    if (sourcePath === null) throw new Error(`package export target is outside the repository: ${entry.sourceFile}`);
    lines.push(`| ${codeCell(entry.importPath)} | [${sourcePath}](${markdownHref(root, pagePath, sourcePath)}) | ${packageExportRows(entry).length} |`);
  }
  lines.push("");

  for (const entry of group.entries) {
    const sourcePath = repoRelativePath(root, entry.sourceFile);
    if (sourcePath === null) throw new Error(`package export target is outside the repository: ${entry.sourceFile}`);
    lines.push(`## ${codeCell(entry.importPath)}`, "", `Source module: [${sourcePath}](${markdownHref(root, pagePath, sourcePath)})`, "");
    if (entry.symbols.length === 0) {
      lines.push("No named exports.", "");
    } else {
      lines.push(...renderExportTable(root, pagePath, entry), "");
    }
  }
  return lines.join("\n");
}

function renderApiIndex(root: string, groups: PackageGroup[]): string {
  const lines = [
    "# API Reference",
    "",
    "> Generated by `bun run gen` from `packages/*/package.json` exports and the TypeScript Compiler API; do not edit by hand.",
    "",
    "This is a compact navigation index for TextEDA's workspace APIs, not a semver or compatibility promise. The linked package pages contain signatures, type displays, summaries, and declaration source links for each public import path. Runtime behavior, error semantics, and design rules remain in the linked authorities below.",
    "",
    "## Authoritative references",
    "",
    "| Need | Authority |",
    "|---|---|",
    "| IR fields, types, and units | [`docs/ir-reference.md`](../ir-reference.md) |",
    "| Diagnostic codes, severity, and repair pointers | [`docs/error-codes.md`](../error-codes.md); [ADR-0003](../adr/01-language/0003-diagnostic-error-codes.md) |",
    "| Language and schematic semantics | [`spec/teda.md`](../../spec/teda.md); [`spec/schematic-view.md`](../../spec/schematic-view.md) |",
    "| PCB physical facts and binding rules | [`spec/pcb.md`](../../spec/pcb.md) |",
    "| Runtime boundaries and implementation stack | [ADR-0038](../adr/10-process/0038-implementation-stack-and-agent-entry.md); [`AGENTS.md`](../../AGENTS.md) §12 |",
    "| Agent verbs and tool schemas | [`packages/cli/src/tools.ts`](../../packages/cli/src/tools.ts); [ADR-0044](../adr/10-process/0044-the-agent-surface-is-a-set-of-verbs.md) |",
    "| Host tool formats | [`docs/tool-formats.md`](../tool-formats.md); [`docs/plugin-hosts.md`](../plugin-hosts.md) |",
    "",
    "## CLI and agent interfaces",
    "",
    "| Surface | Entry point |",
    "|---|---|",
    "| CLI command syntax and dispatch | [`packages/cli/scripts/texteda.ts`](../../packages/cli/scripts/texteda.ts) |",
    "| Machine-readable verb catalogue | [`packages/cli/src/tools.ts`](../../packages/cli/src/tools.ts); inspect with `bun run texteda tools --json` |",
    "| MCP stdio adapter | [`packages/cli/src/mcp.ts`](../../packages/cli/src/mcp.ts); [ADR-0045](../adr/10-process/0045-the-mcp-server-is-a-slice-we-write-ourselves.md) |",
    "| Agent workflows | [`docs/skills/`](../skills/) |",
    "",
    "## TypeScript package APIs",
    "",
    "| Package | Public import paths |",
    "|---|---|",
  ];

  for (const group of groups) {
    const pagePath = apiPagePath(root, group);
    const targetPath = `docs/api-reference/${pagePath}`;
    const entryLinks = group.entries
      .map((entry) => `[${codeCell(entry.importPath)}](${markdownHref(root, "README.md", targetPath)})`)
      .join("<br>");
    lines.push(`| ${codeCell(group.packageName)} | ${entryLinks} |`);
  }
  lines.push("", "Start with the matching package and import path; each package page groups its exported subpaths.", "");
  return lines.join("\n");
}

export function renderApiReference(repositoryRoot: string): ApiReferenceDocument[] {
  const root = realpathSync(repositoryRoot);
  const groups = packageGroups(collectExports(root));
  const documents: ApiReferenceDocument[] = [{ path: "README.md", content: renderApiIndex(root, groups) }];
  for (const group of groups) {
    documents.push({ path: apiPagePath(root, group), content: renderPackagePage(root, group) });
  }
  const paths = new Set<string>();
  for (const document of documents) {
    if (paths.has(document.path)) throw new Error(`duplicate API reference output path: ${document.path}`);
    paths.add(document.path);
  }
  return documents;
}

function generatedPaths(directory: string, prefix = ""): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}${entry.name}`;
    return entry.isDirectory() ? generatedPaths(join(directory, entry.name), `${path}/`) : [path];
  });
}

function runGenerator(): void {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDirectory, "..");
  const outputDirectory = join(root, "docs", "api-reference");
  const legacyPath = join(root, "docs", "api-reference.md");
  const documents = renderApiReference(root);
  const expectedPaths = documents.map((document) => document.path).sort();

  if (process.argv.includes("--check")) {
    const actualPaths = generatedPaths(outputDirectory).sort();
    if (existsSync(legacyPath) || actualPaths.join("\n") !== expectedPaths.join("\n")) {
      console.error("docs/api-reference/ is stale; run `bun run gen`.");
      process.exitCode = 1;
      return;
    }
    for (const document of documents) {
      const current = readFileSync(join(outputDirectory, document.path), "utf8");
      if (current !== document.content) {
        console.error("docs/api-reference/ is stale; run `bun run gen`.");
        process.exitCode = 1;
        return;
      }
    }
    console.log(`docs/api-reference/ is up to date (${documents.length} files).`);
    return;
  }

  const expectedSet = new Set(expectedPaths);
  for (const path of generatedPaths(outputDirectory)) {
    if (expectedSet.has(path)) continue;
    const stalePath = join(outputDirectory, path);
    if (readFileSync(stalePath, "utf8").includes("> Generated by `bun run gen`")) rmSync(stalePath);
  }
  rmSync(legacyPath, { force: true });
  for (const document of documents) {
    const outputPath = join(outputDirectory, document.path);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, document.content);
  }
  console.log(`generated docs/api-reference/ (${documents.length} files)`);
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) runGenerator();
