// `texteda review <project dir>` — the review app (ADR-0035 decision 7).
//
// A browser app served by the CLI on 127.0.0.1: the file system stays here, the browser receives JSON
// and SVG only. Two things this file deliberately does not do: it does not parse or lay out anything
// itself (the parser, the renderer and the checks already own that), and it does not add behaviour to
// the drawing (the app does, around the SVG it is given).
//
// `--out <file>` writes the same document as one self-contained HTML file, which is the static review
// report CI can attach to a pull request (ADR-0035 decision 7: one bundle, three hosts).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ReviewModel } from "@texteda/viewer";
import { clientScript } from "@texteda/viewer/build";
import {
  commitPlan,
  planLayout,
  renderPageSource,
  savePageSource,
  type LayoutPlace,
} from "./layout.ts";
import { buildReviewModel } from "./review-model.ts";

export interface ReviewOptions {
  readonly root: string;
  /** Port to listen on; 0 asks the OS for a free one. Ignored with `--out`. */
  readonly port: number;
  /** Write a static HTML report here instead of serving. */
  readonly outFile: string | undefined;
}

/** Integer nanometres → millimetres, three decimals (a micrometre): the drawing's own resolution. */




/** Flatten a diagnostic for the browser: what to read, where, and how bad. */


/** One page, drawn; or a page that says why it has no drawing. */


/**
 * The board's physical canvas, or the reason it has none.
 *
 * The canvas is the board description drawn by the renderer: the outline, the placed parts with
 * their pads, the copper and the silkscreen. A board with no `pcb` description has no canvas —
 * the app says so rather than inventing one (ADR-0042 D7).
 */


/** The page's symbols and texts as the browser needs them: boxes in millimetres. */


/** The board's instances with the facts a click reports, in board order (the IR's own order). */


/**
 * Build the payload the page shows.
 *
 * Every board that has a schematic becomes a board; a board with no view file becomes a board with no
 * pages and a note saying so — the honest state of ADR-0035 decision 6, not an invented layout.
 */




/** Escape text for a `<script>` element: `</script>` inside the JSON would end the block. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The whole app as one document: styles, the model, the script.
 *
 * Self-contained on purpose — it is served to `127.0.0.1` and written to disk for CI with the same
 * bytes, so what a reviewer looked at and what the report contains cannot differ.
 */
export async function renderReviewHtml(model: ReviewModel): Promise<string> {
  const script = await clientScript();
  const title = `${model.project.name} — TextEDA review`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${DOCUMENT_STYLES}</style>
</head>
<body>
<div id="app"><p class="boot">Loading the review model…</p></div>
<script>window.__TEXTEDA_REVIEW__ = ${scriptJson(model)};</script>
<script type="module">${script}</script>
</body>
</html>
`;
}

// The document's own rules: it owns `html`, `body` and the boot placeholder, and nothing else.
// The app's frame is its own stylesheet and travels with the mount (packages/viewer/src/styles.ts),
// because a plugin mounts the app into a host page whose `body` it does not own.
const DOCUMENT_STYLES = `
html, body { height: 100%; margin: 0; background: #131416; }
* { box-sizing: border-box; }
.boot { padding: 24px; color: #9aa0a6; font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; }
`;

/**
 * The two write routes.
 *
 * Both take the board and page from the request and check them against the model the server
 * already holds: a route may only touch a print page the project actually has, so a request cannot
 * name a path of its own. The layout route either plans (the browser draws the result and the user
 * decides) or commits (the file is written and the model is rebuilt). The edit route saves the
 * source it is given, in the formatter's form, and answers with the page as it is drawn.
 */
async function handleApi(
  root: string,
  url: string,
  request: IncomingMessage,
  response: ServerResponse,
  rebuild: () => ReviewModel,
): Promise<void> {
  const send = (status: number, body: unknown): void => {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(text);
  };
  try {
    const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
    if (url === "/api/layout") {
      const model = rebuild();
      const board = model.boards.find((candidate) => candidate.id === body["board"]);
      if (board === undefined) {
        send(400, { error: `no such board: ${String(body["board"])}` });
        return;
      }
      const pageId = String(body["page"]);
      const page = model.drawings.find(
        (candidate) => candidate.kind === "sch" && candidate.board === board.id && candidate.page === pageId,
      );
      if (page === undefined) {
        send(400, { error: `no such print page: ${pageId}` });
        return;
      }
      const places = Array.isArray(body["places"]) ? (body["places"] as LayoutPlace[]) : [];
      // The editor's unsaved text, when the app holds one: the layout is computed on it and the
      // write is it with the moved rows applied, so a drag cannot discard the edit (ADR-0042 D6).
      const draft = typeof body["text"] === "string" ? { text: body["text"] } : {};
      const plan = planLayout(root, { board: board.id, page: pageId, places, ...draft });
      if (body["commit"] === true) {
        commitPlan(root, plan);
        const after = rebuild();
        send(200, {
          changed: plan.changed,
          conflicts: plan.conflicts,
          reseated: plan.reseated,
          svg: plan.svg,
          model: after,
        });
        return;
      }
      send(200, {
        changed: plan.changed,
        conflicts: plan.conflicts,
        reseated: plan.reseated,
        svg: plan.svg,
      });
      return;
    }

    // The edit route: the source of a page the project has.
    const model = rebuild();
    const file = String(body["file"] ?? "");
    const owner = model.drawings.find((candidate) => candidate.kind === "sch" && candidate.file === file);
    if (owner === undefined || owner.board === undefined || owner.page === undefined) {
      send(400, { error: `no such print page: ${file}` });
      return;
    }
    const text = String(body["text"] ?? "");
    if (body["save"] === true) {
      const saved = savePageSource(root, owner.board, owner.page, text);
      if (saved.errors.length > 0) {
        send(400, { errors: saved.errors });
        return;
      }
      const after = rebuild();
      send(200, { changed: saved.changed, model: after });
      return;
    }
    const drawn = renderPageSource(root, owner.board, owner.page, text);
    send(200, { svg: drawn.svg, errors: drawn.errors, anchors: drawn.anchors });
  } catch (error) {
    send(400, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** The request's body, as text. */
function readBody(request: IncomingMessage): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let text = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    text += chunk;
    if (text.length > 4_000_000) reject(new Error("the request body is too large"));
  });
  request.on("end", () => resolve(text));
  request.on("error", reject);
  return promise;
}

/**
 * Serve the app on `127.0.0.1:port`, or write it to `outFile` and return.
 *
 * The server answers the document, and two write routes: the layout Apply and the edit mode's
 * save. Both own the file system: the browser asks, the server writes (ADR-0042 D9). The static
 * export (`--out`) has no routes at all — it is a document, not a server — and the app says so
 * when a write is asked of it.
 */
export async function runReview(options: ReviewOptions): Promise<number> {
  let model = { ...buildReviewModel(options.root), writable: true };
  const html = await renderReviewHtml(model);

  if (options.outFile !== undefined) {
    const target = resolve(options.outFile);
    mkdirSync(dirname(target), { recursive: true });
    // A static document has no server behind it: the app must not offer to write (ADR-0042 D9).
    writeFileSync(target, await renderReviewHtml({ ...model, writable: false }));
    process.stdout.write(`${target}\n`);
    return 0;
  }

  const server = createServer((request, response) => {
    const url = request.url ?? "/";
    if (request.method === "POST" && (url === "/api/layout" || url === "/api/source")) {
      void handleApi(options.root, url, request, response, () => {
        model = { ...buildReviewModel(options.root), writable: true };
        return model;
      });
      return;
    }
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // The document is regenerated on every start; a cached copy would show a stale drawing.
      "cache-control": "no-store",
    });
    response.end(html);
  });

  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(options.port, "127.0.0.1", listening.resolve);
  await listening.promise;
  // Ctrl-C stops a dev server: that is a normal end, not a failure. Without this the signal reaches
  // Bun's wrapper, which reports the process as killed (a failing exit code in a script or a
  // supervisor) for something the user asked for.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close();
      process.exit(0);
    });
  }

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  process.stdout.write(`review ${model.project.name} at http://127.0.0.1:${port}/\n`);
  process.stdout.write(`${model.boards.length} boards, ${model.diagnostics.length} diagnostics\n`);
  return 0;
}
