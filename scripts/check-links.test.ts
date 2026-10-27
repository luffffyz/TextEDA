// Tests for scripts/check-links.ts. The gate must stay byte-identical in its CLI output; these tests pin the
// individual checks it performs on small synthetic trees so a future edit cannot silently drop or alter one.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { checkRepo } from "./check-links.ts";

type File = Record<string, string>;

function makeTree(files: File): string {
  const root = mkdtempSync(join(tmpdir(), "check-links-"));
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return root;
}

function removeTree(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

const minimalIndex = "# ADR Index\n";

function indexRow(number: string, target: string, title: string, status: string, date: string): string {
  return `| [ADR-${number}](${target}) | ${title} | ${status} | ${date} |`;
}

function adrFile(number: string, title: string, status: string, date: string): string {
  return `# ADR-${number}: ${title}\nStatus: ${status}\nDate: ${date}\n`;
}

describe("scripts/check-links.ts", () => {
  test("exempts root-relative links", () => {
    const root = makeTree({
      "prose.md": "# Prose\n\n[link](/foo.md)\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  test("reports a real missing link target", () => {
    const root = makeTree({
      "prose.md": "[missing](missing.md)\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("link target does not exist: missing.md"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  test("exempts placeholder link targets", () => {
    const root = makeTree({
      "prose.md": "[p1](XXXX-0006.md)\n[p2](…)\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  test("requires an ADR number to resolve or be reserved", () => {
    const root = makeTree({
      "prose.md": "ADR-0006 is mentioned\nADR-0099 is reserved\n",
      "docs/adr/README.md": `${minimalIndex}\n| ADR-0099 | \`0099-not-yet.md\` | F34 |\n`,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("ADR-0006 is mentioned"))).toBe(true);
      expect(problems.some((p) => p.includes("ADR-0099 is mentioned"))).toBe(false);
    } finally {
      removeTree(root);
    }
  });

  test("resolves an ADR link to the decision record", () => {
    const root = makeTree({
      "docs/adr/0006-accepted.md": adrFile("0006", "Title", "Accepted", "2026-10-20"),
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-accepted.md", "Title", "Accepted", "2026-10-20")}\n`,
      "prose.md": "[ADR-0006](docs/adr/0006-accepted.md)\n",
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  test("syncs the ADR index against the records on disk", () => {
    const root = makeTree({
      "docs/adr/0006-accepted.md": adrFile("0006", "Title", "Accepted", "2026-10-20"),
      "docs/adr/0007-page.md": adrFile("0007", "Page", "Accepted", "2026-10-20"),
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-accepted.md", "Title", "Accepted", "2026-10-20")}\n${indexRow("0099", "0099-x.md", "Accepted", "2026-10-20")}\n`,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("ADR-0007") && p.includes("is not listed"))).toBe(true);
      expect(problems.some((p) => p.includes("ADR-0099") && p.includes("is listed but has no file"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  test("validates the decision-record header shape", () => {
    const root = makeTree({
      "docs/adr/0006-noStatus.md": "# ADR-0006: No Status\nDate: 2026-10-20\n",
      "docs/adr/0007-wrongH1.md": "# ADR-0099: Wrong Title\nStatus: Accepted\nDate: 2026-10-20\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes('expected exactly one "Status:" header line'))).toBe(true);
      expect(problems.some((p) => p.includes("the H1 says ADR-0099 but the file name says ADR-0007"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  test("requires a dated appendix/addendum/amendment heading", () => {
    const root = makeTree({
      "docs/adr/0006-amend.md": "# ADR-0006: Amend\nStatus: Accepted\nDate: 2026-10-20\n\n## Appendix\n\nline\nline\n",
      "docs/adr/0007-amend.md": "# ADR-0007: Amend\nStatus: Accepted\nDate: 2026-10-20\n\n## Appendix (2026-10-27)\n\nline\nline\n",
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-amend.md", "Amend", "Accepted", "2026-10-20")}\n${indexRow("0007", "0007-amend.md", "Amend", "Accepted", "2026-10-20")}\n`,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("0006-amend.md") && p.includes("missing a date"))).toBe(true);
      expect(problems.some((p) => p.includes("0007-amend.md"))).toBe(false);
    } finally {
      removeTree(root);
    }
  });

  test("requires a retired record to keep no body heading", () => {
    const root = makeTree({
      "docs/adr/0006-retired.md": `# ADR-0006: Retired\nStatus: Accepted\nDate: 2026-10-20\n\n> **Retired 2026-10-20**\n\n## Body Heading\nbody\n`,
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-retired.md", "Retired", "Accepted", "2026-10-20")}\n`,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("0006-retired.md") && p.includes("keeps no body"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  test("requires a retired record to name its supersession", () => {
    const root = makeTree({
      "docs/adr/0006-retired2.md": `# ADR-0006: Retired2\nStatus: Accepted (superseded by ADR-0007)\nDate: 2026-10-20\n\n> **Retired 2026-10-20**\n`,
      "docs/adr/0007-super.md": adrFile("0007", "Super", "Accepted", "2026-10-20"),
      "docs/adr/0008-retired3.md": `# ADR-0008: Retired3\nStatus: Accepted\nDate: 2026-10-20\n\n> **Retired 2026-10-20**\n`,
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-retired2.md", "Retired2", "Accepted", "2026-10-20")}\n${indexRow("0007", "0007-super.md", "Super", "Accepted", "2026-10-20")}\n${indexRow("0008", "0008-retired3.md", "Retired3", "Accepted", "2026-10-20")}\n`,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("0008-retired3.md") && p.includes('must contain "superseded by ADR-NNNN"'))).toBe(true);
      expect(problems.some((p) => p.includes("0006-retired2.md"))).toBe(false);
    } finally {
      removeTree(root);
    }
  });

  test("warns on an appendix block above 40% of a record", () => {
    const root = makeTree({
      "docs/adr/0006-large-amend.md": `# ADR-0006: Large\nStatus: Accepted\nDate: 2026-10-20\n\n## Appendix (2026-10-27)\n\nline\nline\nline\nline\nline\nline\n`,
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-large-amend.md", "Large", "Accepted", "2026-10-20")}\n`,
    });
    try {
      const { problems, warnings } = checkRepo(root);
      expect(problems).toHaveLength(0);
      expect(warnings.some((w) => w.includes("consolidate"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  // The skip list and the status vocabulary are `Set`s, not object literals: a plain object answers
  // `d["constructor"] !== undefined`, so a directory or status word named after a prototype member
  // would be silently skipped or silently accepted.
  test("does not confuse a prototype property with a listed entry", () => {
    const root = makeTree({
      "constructor/prose.md": "[missing](missing.md)\n",
      "docs/adr/0006-proto.md": `# ADR-0006: Proto\nStatus: toString\nDate: 2026-10-20\n`,
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-proto.md", "Proto", "toString", "2026-10-20")}\n`,
    });
    try {
      const { problems } = checkRepo(root);
      // The `constructor/` directory is not skipped, so its broken link is reported.
      expect(problems.some((p) => p.includes("link target does not exist"))).toBe(true);
      // `toString` is not in the closed status vocabulary, so it is rejected.
      expect(problems.some((p) => p.includes("unknown status word"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });
});
