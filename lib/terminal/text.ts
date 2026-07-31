// 等宽终端里的文本排版工具。和命令无关，neofetch / posts / ls 都在用

/**
 * 中日韩字符在等宽字体里占两列，而 padEnd 按 UTF-16 码元算 ——
 * 直接 padEnd 会让中文比英文短一截，对不齐
 */
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

/** 按显示列数右侧补空格 */
export function padCols(s: string, cols: number): string {
  return s + " ".repeat(Math.max(0, cols - displayWidth(s)));
}
