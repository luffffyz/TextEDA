// 排序比较器：canonical 顺序只认两件事——ASCII 字节序与焊盘号的自然序。

/** ASCII 字节序（不用 localeCompare：它受语言环境与 numeric 选项影响）。 */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 自然序：两侧都是纯数字时按数值比（`2` 在 `10` 前），否则按字节序。 */
export function naturalCompare(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b);
  return byteCompare(a, b);
}
