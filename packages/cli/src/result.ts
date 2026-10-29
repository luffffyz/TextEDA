// What a verb returns when it is asked for a value instead of for output.
//
// A verb that prints cannot be adapted: a host's tool registry wants the value, and the command
// line wants the words. So every verb computes into a `VerbResult` and the script prints it
// (ADR-0143 D2). The two faces call the same function, so they cannot drift.

/** The outcome of a verb: the value it computed, or why it could not. */
export interface VerbResult<T> {
  /** Whether the verb produced its value. A value that reports errors is still a value. */
  readonly ok: boolean;
  /** The computed value; present exactly when `ok` is true. */
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
