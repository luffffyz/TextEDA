// 诊断格式与 teda.md §11 一致：file:line:col: <severity> <code>: <message>
export type Severity = "error" | "warning";

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: Severity;
  code: string;
  message: string;
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.line}:${d.col}: ${d.severity} ${d.code}: ${d.message}`;
}
