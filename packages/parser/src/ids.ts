// Device references: a device is named by its bare id (`tps7a02`).
//
// The `<lib>:<id>` form was withdrawn with the vendored library (ADR-0133): every device a project
// reads is its own file under `assets/components/`, so a qualifier names nothing. The syntax is
// still recognised here, in one place, so that a stale reference is reported as a policy error
// (`ref.library-qualified-id`) rather than as a typo.
export const DEVICE_ID_RE = /^[a-z][a-z0-9-]*$/;

/** The withdrawn form: a name, a colon, then the id. */
export const QUALIFIED_REF_RE = /^[a-z][a-z0-9_-]*:/;

/**
 * A file's revision name (`rev`, ADR-0133 decision 6): the release in which *this file's* facts were
 * last established — a tag or a commit hash, never a branch name.
 *
 * No whitespace and no `#` (the lexer ends a comment there). `2.1.0+local.1` is legal: `+local.N`
 * marks a copy whose facts diverged from the library it came from (decision 6).
 */
export const REV_RE = /^[^\s#]+$/;
