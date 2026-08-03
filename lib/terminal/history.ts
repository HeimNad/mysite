// 历史展开（!!、!n、!前缀）和 Ctrl+R 的反向搜索。纯函数，node --test 直接测。
//
// 这两样都发生在命令执行之前，是 shell 的活不是命令的活 ——
// 所以它们不在 COMMANDS 表里，也不该有 man 页

/** history 命令按 1 开始编号，!n 也是，所以下标要减一 */
export type Expansion =
  | { command: string; expanded: boolean }
  | { error: string };

/**
 * bash 的历史展开：!! 上一条，!3 第三条，!git 最近一条以 git 开头的。
 * 只作用于第一个词，后面的参数原样接上 —— 所以 !! | grep x 是成立的
 */
export function expandHistory(input: string, history: string[]): Expansion {
  // 单独一个 ! 在 bash 里就是普通字符，别抢
  const m = /^(!!|!-?\d+|![^\s!]+)(.*)$/.exec(input);
  if (!m) return { command: input, expanded: false };

  const [, token, rest] = m;
  let found: string | undefined;

  if (token === "!!") found = history[history.length - 1];
  else if (/^!-\d+$/.test(token)) found = history[history.length - Number(token.slice(2))];
  else if (/^!\d+$/.test(token)) found = history[Number(token.slice(1)) - 1];
  else {
    const prefix = token.slice(1);
    // 从最近的往回找 —— !g 要给最近那条 git，不是最早那条
    for (let i = history.length - 1; i >= 0; i--)
      if (history[i].startsWith(prefix)) {
        found = history[i];
        break;
      }
  }

  if (found === undefined) return { error: `${token}: event not found` };
  return { command: found + rest, expanded: true };
}

/**
 * Ctrl+R：从 before 往前找第一条含 query 的，返回下标；没有就 -1。
 * 大小写不敏感，和 bash 默认一致
 */
export function searchBack(history: string[], query: string, before: number): number {
  if (!query) return -1;
  const needle = query.toLowerCase();
  for (let i = Math.min(before, history.length) - 1; i >= 0; i--)
    if (history[i].toLowerCase().includes(needle)) return i;
  return -1;
}
