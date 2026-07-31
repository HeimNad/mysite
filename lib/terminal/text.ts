// 等宽终端里的文本排版工具。和命令无关，neofetch / posts / ls 都在用

/**
 * 中日韩字符在等宽字体里占两列，而 padEnd 按 UTF-16 码元算 ——
 * 直接 padEnd 会让中文比英文短一截，对不齐
 *
 * 一律用 \u 转义，不写字面量：原来这里是 `豈-﫿`，本意是 U+F900 起的兼容表意
 * 文字，但打出来的"豈"是 U+8C48（长得一模一样的普通汉字），范围于是从汉字区
 * 中间横跨到 U+FAFF，把拉丁扩展、彝文、私用区全算成了双宽。字面量看不出这种错
 */
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

/** 按显示列数右侧补空格 */
export function padCols(s: string, cols: number): string {
  return s + " ".repeat(Math.max(0, cols - displayWidth(s)));
}
