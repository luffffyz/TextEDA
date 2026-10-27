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

  // Section references are the form that drifts silently: a `§N` keeps looking fine after the
  // subsection it named is renumbered or deleted. The binding rule is what keeps the check honest —
  // `teda.md §7, §7.5` binds both numbers to teda.md, while a section number that follows an
  // unrelated sentence must not steal that file.
  test("resolves a qualified section reference", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 4. Section\n\n### 4.9 Detail\n",
      "prose.md": "# Prose\n\nSee `spec/a.md` §4.9 for detail.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  test("reports a section the named file does not declare", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 4. Section\n",
      "prose.md": "# Prose\n\nSee `spec/a.md` §4.7.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("spec/a.md §4.7"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  test("binds every number of a section list to the named file", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 7. Top\n\n### 7.5 Five\n\n### 7.7 Seven\n",
      // 7.6 is declared by nothing; the list form is how a real drift (7.7 missing) is written.
      "prose.md": "# Prose\n\nSee `spec/a.md` §7, §7.5, §7.6.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("spec/a.md §7.6");
    } finally {
      removeTree(root);
    }
  });

  test("does not bind a section number across a sentence break", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 4. Section\n",
      "spec/b.md": "# B\n\n## 13. Other\n\n### 13.4 Detail\n",
      // `§13.4` belongs to b.md (stated earlier in the sentence), not to the a.md named just before it.
      "prose.md": "# Prose\n\nPer `spec/b.md`, §13.4 applies; see also `spec/a.md`.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  // A decision record is a statement about the past: a pointer that has since rotted is worth
  // reporting, but rewriting the record to chase it would destroy the attribution it exists for.
  test("downgrades a dead pointer in a decision record to a warning", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 4. Section\n",
      "docs/adr/0006-past.md": `# ADR-0006: Past\nStatus: Accepted\nDate: 2026-10-20\n\nImpact: \`spec/a.md\` §9\n`,
      "docs/adr/README.md": `${minimalIndex}\n${indexRow("0006", "0006-past.md", "Past", "Accepted", "2026-10-20")}\n`,
    });
    try {
      const { problems, warnings } = checkRepo(root);
      expect(problems).toHaveLength(0);
      expect(warnings.some((w) => w.includes("spec/a.md §9"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  test("accepts a bare section number that some document declares", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 11. Rules\n",
      "prose.md": "# Prose\n\nAs stated in §11.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  test("reports a section number no document declares", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 11. Rules\n",
      "prose.md": "# Prose\n\nAs stated in §99.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("§99"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  // Backlog numbers are cited from every document, and a done item leaves the list entirely.
  test("accepts an open backlog item and one recorded as closed", () => {
    const root = makeTree({
      "docs/backlog.md": "# Backlog\n\n**F2（old work）已关闭** → `docs/adr/README.md`\n\n## F12. Open item\n",
      "prose.md": "# Prose\n\nSee F12 and F2.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  test("reports a backlog item that is neither open nor closed", () => {
    const root = makeTree({
      "docs/backlog.md": "# Backlog\n\n## F12. Open item\n",
      "prose.md": "# Prose\n\nSee F41.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems.some((p) => p.includes("F41"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  // ADR-0016's retired numeric diagnostic codes (`F200`, `F100`) look exactly like backlog items.
  test("ignores a backlog-shaped token inside inline code", () => {
    const root = makeTree({
      "docs/backlog.md": "# Backlog\n\n## F12. Open item\n",
      "prose.md": "# Prose\n\nThe old numeric codes (`F200` / `S113`) are retired.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems } = checkRepo(root);
      expect(problems).toHaveLength(0);
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

  // The section check memoizes the numbered headings it has read. A second run over the same tree
  // must not answer from the first run's cache: the file may have been edited in between.
  test("sees an edited section list on a second run over the same tree", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 4.7 Something\n",
      "prose.md": "# Prose\n\nSee a.md §4.7 for the rule.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
      // Rename the section: the same reference now points at nothing.
      writeFileSync(join(root, "spec", "a.md"), "# A\n\n## 4.8 Something\n", "utf-8");
      const second = checkRepo(root);
      expect(second.problems.some((p) => p.includes("has no such section"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  // A list that continues after the first number keeps the file it names: `a.md §3–§5, §10` says
  // three things about one file, and the second and third are not bare numbers.
  test("binds a continued list to the file it names", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 3 Rows\n\n## 5 Lexicon\n\n## 10 Units\n",
      "prose.md": "# Prose\n\nSee a.md §3–§5, §10 for the rules.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  // The same list written with a slash between the numbers, the way the specs write it.
  test("binds a slash-separated list to the file it names", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 4.9 Openings\n\n## 4.10 Silks\n",
      "prose.md": "# Prose\n\nSee a.md §4.9 / §4.10 for the rules.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  // The file name may live in the link target: `[a.md](a.md) §9.2` names the file as clearly as
  // `a.md §9.2` does, so the section number binds to it rather than becoming a bare one.
  test("binds a section number to the file named by the enclosing link", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 9.2 Rules\n",
      "prose.md": "# Prose\n\nSee [a.md](spec/a.md) §9.2 for the rules.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  // A bare number that belongs to another file is ambiguous: the reader has to guess which file it
  // means, and the check cannot help them because the reference carries no file name. The writing
  // rule asks for the qualified form, so this is a warning rather than a failure.
  test("warns about a bare section number that only another file declares", () => {
    const root = makeTree({
      "spec/a.md": "# A\n\n## 9.2 Rules\n",
      "prose.md": "# Prose\n\nSee §9.2 for the rules.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      const { problems, warnings } = checkRepo(root);
      expect(problems.some((p) => p.includes("§9.2"))).toBe(false);
      expect(warnings.some((p) => p.includes("§9.2"))).toBe(true);
    } finally {
      removeTree(root);
    }
  });

  // A section number that belongs to a datasheet is not a reference into this repository: the name
  // in front of it is not a file here, so there is nothing to resolve and nothing to report.
  test("does not treat a datasheet section as a repository reference", () => {
    const root = makeTree({
      "prose.md": "# Prose\n\nThe datasheet SBVS348H §4 lists the pin functions.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  // The second number in `SBVS348H §4 pin functions, §5.3 operating conditions` is the same
  // datasheet, so it is as much outside the tree as the first one.
  test("does not treat a continued datasheet section as a repository reference", () => {
    const root = makeTree({
      "prose.md": "# Prose\n\nSBVS348H §4 pin functions, §5.3 recommended operating conditions.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });

  // A reference written inside one code span is a sample of the notation, not a pointer: the rule
  // that says "write `a.md §4.7`, not `§4.7`" must be able to show both forms without the check
  // resolving the samples it quotes.
  test("does not resolve a reference written as a quoted sample", () => {
    const root = makeTree({
      "prose.md": "# Prose\n\nWrite `a.md §9.9`, not a bare number.\n",
      "docs/adr/README.md": minimalIndex,
    });
    try {
      expect(checkRepo(root).problems).toHaveLength(0);
    } finally {
      removeTree(root);
    }
  });
});
