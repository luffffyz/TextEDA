// The picture half of the TextEDA plugin for a DeepSeek Harness session.
//
// A review surface inside the workbench (ADR-0043 D1, D9): the client half draws the print page and
// reports what a person picked; this half answers what it draws and writes the one thing a person
// may write — the page's `place` rows (ADR-0043 D3). Everything else is the core's: the model is
// `buildReviewModel`, the write is `planPlaces` / `applyPlaces`, and the drawing is the renderer's
// (no host SDK enters the core, AGENTS.md §2 invariant 20).
//
// Two fixed paths, because DSH matches an exact route by its whole path (no wildcard segments):
//
//   GET  /api/texteda-review          the model the client half mounts
//   POST /api/texteda-review/places   the places-only write (plan or commit)
//
// Both take the session as a query parameter, `?sessionId=<id>`. The project root is that session's
// `cwd`: a person reviews the project the session is working in, and two sessions can be two
// projects. A route below `/api` is reachable only inside the host's authentication fence, and
// only by the owner principal, so the session id also names whose project a request may read.
//
// The commit answers with the rebuilt model, as the standalone server does, so the client adopts
// it instead of asking again (ADR-0042 D9).
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { dshTools } from "../../packages/cli/src/dsh-tools.ts";
import { buildReviewModel, reviewGeometry } from "../../packages/cli/src/review-model.ts";
import { applyPlaces, planPlaces, LayoutError } from "../../packages/cli/src/layout.ts";
import type { ReviewCapability, ReviewModel } from "../../packages/viewer/src/types.ts";

export const name = "texteda";

/** The services this plugin needs from the host. */
export const inject = ["tools", "sessions", "connection"];

/** The model route: the client half's GET. */
export const MODEL_PATH = "/api/texteda-review";

/** The write route: the client half's POST. */
export const PLACES_PATH = "/api/texteda-review/places";

/**
 * What this host grants the app (ADR-0043 D3, D6).
 *
 * `review` and `layout` are the two modes that need nothing outside a print page: the drawing, and
 * its `place` rows. `edit` is not offered — the source is the agent's, not the plugin's — and
 * neither is `placement`, which reads a `pcb` description this half does not serve.
 */
const CAPABILITY: ReviewCapability = { modes: ["review", "layout"], write: "places" };

/** One refusal: what the route answers with, and with which status. */
function refuse(status: number, message: string): Response {
    return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

/** The project root the request's session works in, or the reason there is none. */
function projectRoot(ctx: Context, sessionId: string | null): string | { readonly reason: string } {
    if (sessionId === null || sessionId === "") return { reason: "session is required" };
    const session = ctx.sessions.get(sessionId);
    if (session === undefined) return { reason: `no such session: ${sessionId}` };
    const cwd = session.header.cwd;
    if (cwd === undefined) return { reason: `the session has no working directory: ${sessionId}` };
    return cwd;
}

/** The model, with the capability this host grants and the write it can back. */
function reviewModel(root: string): ReviewModel {
    return { ...buildReviewModel(root), writable: true, capability: CAPABILITY };
}

/**
 * Answer the model route.
 *
 * A project that does not compile is not a failure of this route: `buildReviewModel` reports what
 * it found, and the app draws the boards it has with the findings beside them (ADR-0035 D6).
 */
function handleModel(ctx: Context, request: Request): Response {
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    const root = projectRoot(ctx, sessionId);
    if (typeof root !== "string") return refuse(404, root.reason);
    try {
        return Response.json(reviewModel(root), { headers: { "cache-control": "no-store" } });
    } catch (error) {
        return refuse(400, error instanceof Error ? error.message : String(error));
    }
}

/** What the client half sends: which page, and the moves it has pending. */
interface PlacesBody {
    readonly board?: unknown;
    readonly page?: unknown;
    readonly commit?: unknown;
    readonly places?: unknown;
}

/** The moves, narrowed to the shape the write path checks field by field. */
function askedPlaces(value: unknown[]): { instance_id: string; x: number; y: number; rot: number }[] | undefined {
    const places: { instance_id: string; x: number; y: number; rot: number }[] = [];
    for (const row of value) {
        if (typeof row !== "object" || row === null) return undefined;
        const { instance_id, x, y, rot } = row as Record<string, unknown>;
        if (typeof instance_id !== "string") return undefined;
        if (typeof x !== "number" || typeof y !== "number" || typeof rot !== "number") return undefined;
        places.push({ instance_id, x, y, rot });
    }
    return places;
}

/**
 * Answer the places route.
 *
 * `commit: false` plans and draws — the client shows the page as it would be written and the person
 * decides. `commit: true` writes the `place` rows and answers with the rebuilt model. Either way
 * only the `place` rows change; the wires a move disturbs go stale and are reported (`stale`),
 * never re-anchored — that is `texteda view rewire`'s job (ADR-0043 D10).
 */
async function handlePlaces(ctx: Context, request: Request): Promise<Response> {
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    const root = projectRoot(ctx, sessionId);
    if (typeof root !== "string") return refuse(404, root.reason);

    let body: PlacesBody;
    try {
        body = (await request.json()) as PlacesBody;
    } catch {
        return refuse(400, "the request body is not JSON");
    }
    const board = typeof body.board === "string" ? body.board : undefined;
    const page = typeof body.page === "string" ? body.page : undefined;
    if (board === undefined || page === undefined) return refuse(400, "board and page are required");
    if (!Array.isArray(body.places)) return refuse(400, "places must be an array");
    const places = askedPlaces(body.places);
    if (places === undefined) return refuse(400, "a place needs instance_id, x, y and rot");

    // The request may name only a print page the project has, and the check is the model's own: a
    // route that trusted the body's paths would be a way to write a file the app never showed.
    const model = buildReviewModel(root);
    const owner = model.boards.find((candidate) => candidate.id === board);
    if (owner === undefined) return refuse(400, `no such board: ${board}`);
    const drawing = model.drawings.find(
        (candidate) => candidate.kind === "sch" && candidate.board === board && candidate.page === page,
    );
    if (drawing === undefined) {
        return refuse(400, `no such print page: ${page}`);
    }

    const ask = { board, page, places };
    try {
        if (body.commit !== true) {
            const plan = planPlaces(root, ask);
            // The plan hands back the renderer's geometry (integer nanometres); the app reads boxes
            // in millimetres. Converting with the model's own rule keeps one conversion in the tree.
            const drawn = reviewGeometry(plan.geometry);
            return Response.json(
                {
                    changed: plan.changed,
                    stale: plan.stale,
                    svg: plan.svg,
                    symbols: drawn.symbols,
                    texts: drawn.texts,
                },
                { headers: { "cache-control": "no-store" } },
            );
        }
        const outcome = applyPlaces(root, ask);
        return Response.json(
            { changed: outcome.changed, stale: outcome.stale, model: reviewModel(root) },
            { headers: { "cache-control": "no-store" } },
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return refuse(error instanceof LayoutError ? 400 : 500, message);
    }
}

export function apply(ctx: Context): void {
    // The verbs first: the agent's surface is the same catalogue every other host gets
    // (ADR-0044 D2, D5). This half of the plugin adds the picture; it does not change the verbs.
    for (const tool of dshTools()) {
        ctx.tools.register(defineTool(tool));
    }

    // One route per (path, method). The disposer's lifetime is this plugin's: `register` tracks it
    // on the owning context, so a torn-down plugin leaves no route behind.
    ctx.connection.fetch.register({
        path: MODEL_PATH,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: (request) => Promise.resolve(handleModel(ctx, request)),
    });
    ctx.connection.fetch.register({
        path: PLACES_PATH,
        methods: ["POST"],
        requestBody: "buffered",
        fetch: (request) => handlePlaces(ctx, request),
    });
}
