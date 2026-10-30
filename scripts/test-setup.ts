// The per-test budget for the whole suite, loaded through `bunfig.toml`.
//
// Bun's default is 5 s. The tests that drive the CLI start a process per case
// -- the tool catalogue alone runs the command eight times -- and a shared CI
// runner is about twice as slow as a laptop, so the default cut those runs
// short: the child was killed and the failure read "expected 0, received
// null" instead of naming the cause. 30 s leaves room for a slow runner and
// still fails a hung test long before the CI job gives up.
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(30_000);
