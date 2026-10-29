// The picture half of the TextEDA plugin, as a DeepSeek Harness client module.
//
// What a host draws (ADR-0142 D2, D9): this module registers one right-sidebar tab whose body is
// the review app. It is a mount, not a second app — the same `mountReview` the standalone page runs,
// with the model and the write channel handed in by this host instead of by `texteda review`
// (ADR-0142 D2). Nothing here draws a schematic or decides what a move means; both live in
// `@texteda/viewer` and in the CLI's core.
//
// Why the right sidebar and not a tool row: the app is a three-column frame (boards, sheet,
// inspector) and a `tool.call.toolview` renders inside a conversation row, too narrow for it. The
// tab is session-scoped (`scope: 'session'` on `sidebar.right.pane.tab`), so its body is handed the
// `sessionId` the host half wants: the project root is that session's `cwd`.
//
// The write channel: the app asks its host with paths of its own (`/api/layout`, `/api/source`).
// This module answers the first and refuses the second. Refusing is not a gap — the plugin grants
// no `edit` mode (the source is the agent's to write, ADR-0142 D3), so the app never asks, and a
// refusal is what a mode that somehow did ask would get.
//
// Written with `createElement` and no JSX on purpose: the repository has no React dependency, and
// the host supplies React as a platform module (DSH's `PLATFORM_MODULES`). A `.tsx` file would need
// `react/jsx-runtime` as a dependency of this repo, which it must not have.
import type { Context } from "@deepseek-ai/cordis";
import type { ReviewModel, ReviewApi, ReviewAnswer } from "../../packages/viewer/src/types.ts";
import { mountReview } from "../../packages/viewer/src/app.ts";
import { createElement, useEffect, useRef } from "react";

/** The tab kind this module owns; `openTab` names it. */
export const KIND = "texteda-review";

/** This implementation's identity, and the key its body registers under. */
export const ID = "@texteda/dsh-plugin";

/** The routes the host half serves, document-relative (the browser's form has no leading `/api`). */
const MODEL_ROUTE = "api/texteda-review";
const PLACES_ROUTE = "api/texteda-review/places";

/** The services this module needs from the host. */
export const inject = ["slots", "sidebarRightTabs"];

/** One answer from a fetch call, in the shape the app reads. */
async function answer(response: Response): Promise<ReviewAnswer> {
    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
        const parsed: unknown = text === "" ? {} : JSON.parse(text);
        payload = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
        payload = { error: text };
    }
    return { status: response.status, payload };
}

/**
 * The app's write channel, mapped onto this host's two routes.
 * @param sessionId - the session whose project the tab is reviewing.
 * @returns the api the app posts through.
 */
function apiFor(sessionId: string): ReviewApi {
    return {
        async post(path: string, body: unknown): Promise<ReviewAnswer> {
            if (path === "/api/layout") {
                const response = await fetch(`${PLACES_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(body),
                });
                return answer(response);
            }
            // `/api/source` is the standalone app's draft route. This host grants no `edit` mode, so
            // the app never reaches for it; saying so beats a 404 nobody can read.
            return {
                status: 405,
                payload: { error: "this host does not write page source: the agent does" },
            };
        },
    };
}

/**
 * Fetch the model and mount the app into this element.
 *
 * The mount is one per element and lives as long as the element: `useEffect` fetches once, mounts,
 * and destroys the mount when the tab goes away.
 * @param sessionId - the session whose project this tab reviews.
 * @returns the element the app draws in.
 */
function ReviewBody({ sessionId }: { readonly sessionId: string }): unknown {
    const host = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const element = host.current;
        if (element === null) return undefined;
        let cancelled = false;
        let unmount: { destroy(): void } | undefined;
        void (async () => {
            const response = await fetch(`${MODEL_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`);
            const first = await answer(response);
            if (cancelled || host.current !== element) return;
            if (first.status < 200 || first.status >= 300) {
                element.textContent = `the project could not be read: ${String(first.payload["error"] ?? first.status)}`;
                return;
            }
            unmount = mountReview(element, first.payload as unknown as ReviewModel, apiFor(sessionId));
        })();
        return () => {
            cancelled = true;
            unmount?.destroy();
        };
    }, [sessionId]);
    // `height: 100%` because the app's own root rule sizes itself to its container; the tab body's
    // host element has to pass the height down or the frame collapses to its content.
    return createElement("div", { ref: host, style: { height: "100%", overflow: "hidden" } });
}

/**
 * Register the tab type and its body.
 * @param ctx - the client root context with the slot and sidebar services.
 */
export function apply(ctx: Context): void {
    const t = (key: string): string => (key === "title" ? "TextEDA review" : key);

    // The type first: a body registered under a key whose type does not exist has no chip to sit in.
    ctx.effect(
        () =>
            ctx.sidebarRightTabs.register({
                id: ID,
                kind: KIND,
                priority: "extension",
                title: () => t("title"),
                guide: [
                    {
                        id: "review",
                        order: 30,
                        title: () => t("title"),
                        description: () => t("description"),
                    },
                ],
            }),
        "texteda: the review tab type",
    );

    // The body: `register` answers with the registration's disposer, which is what `inject` wants
    // back — the body leaves with the plugin, not before it.
    ctx.effect(
        () =>
            ctx.slots.inject("sidebar.right.pane.tab", () =>
                ctx.slots.register({ name: "sidebar.right.pane.tab", key: ID }, ReviewBody),
            ),
        "texteda: the review tab body",
    );
}
