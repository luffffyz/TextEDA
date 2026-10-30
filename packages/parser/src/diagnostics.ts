// The shared types and helpers for diagnostics live in `@texteda/ir/diagnostics` (ADR-0003: error-code registry and unified shape).
//
// This file only re-exports, so callers of `packages/parser` can keep importing from the local path;
// new code may also import `@texteda/ir/diagnostics` directly.
export type {
  Diagnostic,
  DiagnosticCause,
  DiagnosticCodeId,
  DiagnosticLocation,
  DiagnosticsPayload,
  Severity,
} from "@texteda/ir/diagnostics";
export { diagnosticsToPayload, formatDiagnostic, isDiagnosticCode } from "@texteda/ir/diagnostics";
