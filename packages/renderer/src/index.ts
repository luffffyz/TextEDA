// 参考渲染器（AGENTS.md §1）：IR → 绘图指令 → SVG。
// 不依赖 KiCad：预览是设计回路，KiCad 只管制造出口（ADR-0005）。
export * from "./svg.ts";
export * from "./symbol.ts";
export * from "./footprint.ts";
