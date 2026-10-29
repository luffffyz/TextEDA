// What a verb returns when it is asked for a value instead of for output.
//
// A verb that prints cannot be adapted: a host's tool registry wants the value, and the command
// line wants the words. So every verb computes into a `VerbResult` and the script prints it
// (ADR-0143 D2). The two faces call the same function, so they cannot drift.

/** The outcome of a verb: the value it computed, or why it could not. */
export interface VerbResult<T> {
  /** Whether the verb succeeded: the same answer as the command line's exit code. */
  readonly ok: boolean;
  /** The computed value; present when the verb computed one, even when it failed. */
  readonly value?: T;
  /** Why the verb could not do its work; present exactly when `ok` is false. */
  readonly error?: string;
  /**
   * The cli-domain code of the failure, when the failure is about the caller's arguments rather
   * than about the project. The command line prints it with the usage; a tool hands it back.
   */
  readonly code?: "cli.bad-usage";
}

/** A verb that computed its value. */
export function ok<T>(value: T): VerbResult<T> {
  return { ok: true, value };
}

/** A verb that could not do its work. */
export function failed<T>(error: string): VerbResult<T> {
  return { ok: false, error };
}

/** What a tool call produced: the answer as text, the answer as data, and whether it failed. */
export interface ToolAnswer {
  /** The answer, as the model reads it. */
  readonly text: string;
  /** The answer, as data; absent when the verb had nothing to report. */
  readonly value?: unknown;
  /** Whether the verb failed — the same answer as the command line's exit code. */
  readonly isError: boolean;
}

/**
 * The answer a tool call hands back.
 *
 * A verb that failed but still computed something has computed the answer: a check that found
 * errors has found them, and the model is to see them. So the value is the text whenever there is
 * a value, and the reason is the text only when there is nothing else to say.
 */
export function toolAnswer<T>(result: VerbResult<T>): ToolAnswer {
  if (result.value !== undefined) {
    return { text: JSON.stringify(result.value, null, 2), value: result.value, isError: !result.ok };
  }
  return { text: result.error ?? "The tool could not do its work", isError: true };
}
