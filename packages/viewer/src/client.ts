// The review app in a browser: the model the CLI injected, and the CLI's own routes.
//
// The app itself lives in `app.ts` and is mounted, not run on import, so the same drawing can be
// mounted into a plugin's surface instead (ADR-0043 D2, D9). This file is the browser's half of
// that: it reads the model the server put in the page and points the app at the server's routes.
import { mountReview } from "./app.ts";
import type { ReviewAnswer, ReviewApi, ReviewModel } from "./types.ts";

declare global {
  interface Window {
    __TEXTEDA_REVIEW__: ReviewModel;
  }
}

/** The CLI's routes: the app asks, the server owns the files (ADR-0042 D9). */
const api: ReviewApi = {
  async post(path: string, body: unknown): Promise<ReviewAnswer> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    return { status: response.status, payload };
  },
};

const root = document.getElementById("app");
if (root !== null) mountReview(root, window.__TEXTEDA_REVIEW__, api);
