// The review app's two write routes, over HTTP (ADR-0042 D3, D9).
//
// The browser never touches the file system: it asks the server, the server owns the files. These
// tests therefore talk to a real server -- the same command a person runs -- and check what comes
// back and what lands on disk: a plan that writes nothing, a commit that writes exactly one file,
// a draft that is drawn without being written, a save that refuses a source that does not parse,
// and a request for a page the project does not have.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const referenceProject = join(repoRoot, "examples", "reference-project");
const cli = join(repoRoot, "packages", "cli", "scripts", "texteda.ts");

const pageFile = "views/charger-buck/buck-5v.view.teda";

/** A copy of the reference project, so a test can write into it. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "texteda-review-api-test-"));
  cpSync(referenceProject, dir, { recursive: true });
  return dir;
}

interface Server {
  url: string;
  stop: () => void;
}

/** Start the review app on a free port and wait for it to say where it listens. */
async function serve(dir: string): Promise<Server> {
  const child = Bun.spawn(["bun", "run", cli, "review", dir, "--port", "0"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  let found: RegExpExecArray | null = null;
  while (found === null) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`the server stopped before it said where it listens: ${seen}`);
    seen += decoder.decode(chunk.value, { stream: true });
    found = /http:\/\/[^\s]+/.exec(seen);
  }
  const url = found[0].replace(/\/$/, "");
  return {
    url,
    stop: () => {
      child.kill();
    },
  };
}

/** POST a JSON body and answer with the status and the parsed payload. */
async function post(
  server: Server,
  path: string,
  body: unknown,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> };
}

describe("the review app's write routes", () => {
  test("the layout route plans a change without writing it", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: false,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      expect(String(response.payload["svg"] ?? "")).toContain("<svg");
      // The plan is a picture, not a file: the page on disk is still the one that was there.
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });

  test("the layout route writes the page when it is asked to commit", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: true,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      expect(readFileSync(join(dir, pageFile), "utf8")).toContain("M2.C1  118.0  95.0  90");
    } finally {
      server.stop();
    }
  });

  // The data-loss path (ADR-0042 D6): the editor holds text that was never saved, and a move writes the
  // page back. Without the draft in the request, the write is the file on disk and the edit is
  // gone.
  test("the layout route keeps the editor's unsaved text", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    const draft = text.replace("# TPS5430 5V/3A buck print page.", "# TPS5430 5V/3A buck print page (edited).");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: true,
        text: draft,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      const written = readFileSync(join(dir, pageFile), "utf8");
      // The edit is still there, and so is the move.
      expect(written).toContain("# TPS5430 5V/3A buck print page (edited).");
      expect(written).toContain("M2.C1  118.0  95.0  90");
    } finally {
      server.stop();
    }
  });

  test("the layout route refuses a draft that does not parse, and writes nothing", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/layout", {
        board: "charger-buck",
        page: "buck-5v",
        places: [{ instance_id: "M2.C1", x: 118, y: 95, rot: 90 }],
        commit: true,
        text: "version 0.9.1\nview buck-5v\n\nplace\n  M2.C1  118.0\n",
      });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("syntax.row-too-short");
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });

  test("the layout route refuses a board or a page the project does not have", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const board = await post(server, "/api/layout", { board: "nope", page: "buck-5v", places: [] });
      expect(board.status).toBe(400);
      expect(String(board.payload["error"] ?? "")).toContain("no such board");
      const page = await post(server, "/api/layout", { board: "charger-buck", page: "nope", places: [] });
      expect(page.status).toBe(400);
      expect(String(page.payload["error"] ?? "")).toContain("no such print page");
    } finally {
      server.stop();
    }
  });

  test("the source route draws a draft and says which row each object came from", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", { file: pageFile, text, save: false });
      expect(response.status).toBe(200);
      expect(response.payload["errors"]).toEqual([]);
      expect(String(response.payload["svg"] ?? "")).toContain("<svg");
      const anchors = response.payload["anchors"] as { key: string; kind: string; line: number }[];
      const place = anchors.find((anchor) => anchor.key === "M2.C1");
      expect(place?.kind).toBe("place");
      // The line the row is on: the place row of M2.C1 in the file.
      expect(text.split("\n")[place!.line - 1]).toContain("M2.C1");
    } finally {
      server.stop();
    }
  });

  test("the source route saves the page in the formatter's form", async () => {
    const dir = scratch();
    const text = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", {
        file: pageFile,
        text: text.replace("M2.C1  120.0  95.0  90", "M2.C1  118.0  95.0  90"),
        save: true,
      });
      expect(response.status).toBe(200);
      expect(response.payload["changed"]).toBe(true);
      expect(readFileSync(join(dir, pageFile), "utf8")).toContain("M2.C1  118.0  95.0  90");
    } finally {
      server.stop();
    }
  });

  test("the source route refuses a source that does not parse, and writes nothing", async () => {
    const dir = scratch();
    const before = readFileSync(join(dir, pageFile), "utf8");
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", {
        file: pageFile,
        text: "version 0.9.1\npcb charger-buck\n",
        save: true,
      });
      expect(response.status).toBe(400);
      expect((response.payload["errors"] as string[]).length).toBeGreaterThan(0);
      expect(readFileSync(join(dir, pageFile), "utf8")).toBe(before);
    } finally {
      server.stop();
    }
  });

  test("the source route refuses a file the project does not have", async () => {
    const dir = scratch();
    const server = await serve(dir);
    try {
      const response = await post(server, "/api/source", {
        file: "views/charger-buck/../../../../etc/passwd",
        text: "",
        save: true,
      });
      expect(response.status).toBe(400);
      expect(String(response.payload["error"] ?? "")).toContain("no such print page");
    } finally {
      server.stop();
    }
  });
});
