// less 的状态机。纯函数：状态 + 按键 → 新状态，node --test 直接跑得动。
//
// 这是这台机器上第一个"接管键盘"的程序。在它之前每条命令都是打印完就结束，
// 键盘始终归提示符；less 开着的时候 j/k/空格 属于 less，q 才把键盘还回去。
// 真终端里 less/vim/top 就是这一类，和 ls/cat 是两种东西
//
// 视口高度由 UI 层量出来传进来 —— 那是真实的窗口高度，不是写死的 24 行

export type Pager = {
  lines: string[];
  /** 视口第一行在 lines 里的下标 */
  top: number;
  rows: number;
  /** 状态行左边显示的名字：文件名，或管道进来时的 (stdin) */
  name: string;
  /** 正在输入搜索词时是那串字符，否则 null */
  typing: string | null;
  pattern: string;
  /** 状态行右边的临时提示，比如"没有匹配" */
  message: string;
};

export function openPager(text: string, name: string, rows: number): Pager {
  return {
    lines: text.split("\n"),
    top: 0,
    rows: Math.max(1, rows),
    name,
    typing: null,
    pattern: "",
    message: "",
  };
}

/** 最大的合法 top：再往下翻就看到空白了 */
const maxTop = (p: Pager) => Math.max(0, p.lines.length - p.rows);
const clamp = (p: Pager, top: number): Pager => ({
  ...p,
  top: Math.min(maxTop(p), Math.max(0, top)),
  message: "",
});

function search(p: Pager, pattern: string, from: number, back = false): Pager {
  if (!pattern) return { ...p, typing: null };
  const needle = pattern.toLowerCase();
  const hit = (i: number) => p.lines[i]?.toLowerCase().includes(needle);
  const range = back
    ? Array.from({ length: from }, (_, i) => from - 1 - i)
    : Array.from({ length: p.lines.length - from }, (_, i) => from + i);
  const found = range.find(hit);
  if (found === undefined)
    return { ...p, typing: null, pattern, message: "Pattern not found" };
  return { ...clamp(p, found), typing: null, pattern };
}

/**
 * 按下一个键。返回 null 表示 less 退出、键盘还给提示符。
 * 认不出的键原样返回，和真 less 一样什么都不做
 */
export function pagerKey(p: Pager, key: string): Pager | null {
  // 正在输入搜索词：除了回车和 Esc，其余都往缓冲里塞
  if (p.typing !== null) {
    if (key === "Enter") return search(p, p.typing, p.top + 1);
    if (key === "Escape") return { ...p, typing: null };
    if (key === "Backspace") return { ...p, typing: p.typing.slice(0, -1) };
    return key.length === 1 ? { ...p, typing: p.typing + key } : p;
  }

  const page = p.rows - 1; // 真 less 翻页时留一行重叠，不然容易看丢
  switch (key) {
    case "q":
    case "Escape":
      return null;
    case " ":
    case "f":
    case "PageDown":
      return clamp(p, p.top + page);
    case "b":
    case "PageUp":
      return clamp(p, p.top - page);
    case "d":
      return clamp(p, p.top + Math.floor(p.rows / 2));
    case "u":
      return clamp(p, p.top - Math.floor(p.rows / 2));
    case "j":
    case "ArrowDown":
    case "Enter":
      return clamp(p, p.top + 1);
    case "k":
    case "ArrowUp":
      return clamp(p, p.top - 1);
    case "g":
    case "Home":
      return clamp(p, 0);
    case "G":
    case "End":
      return clamp(p, maxTop(p));
    case "/":
      return { ...p, typing: "", message: "" };
    case "n":
      return search(p, p.pattern, p.top + 1);
    case "N":
      return search(p, p.pattern, p.top, true);
    default:
      return p;
  }
}

/** 视口里的那几行 + 状态行 */
export function pagerView(p: Pager): { body: string[]; status: string } {
  const body = p.lines.slice(p.top, p.top + p.rows);
  // 不足一屏时补空行，状态行才不会往上跳
  while (body.length < p.rows) body.push("");

  if (p.typing !== null) return { body, status: "/" + p.typing };

  const last = Math.min(p.lines.length, p.top + p.rows);
  const atEnd = p.top >= maxTop(p);
  const pct = p.lines.length ? Math.round((last / p.lines.length) * 100) : 100;
  const where = atEnd ? "(END)" : `${pct}%`;
  return {
    body,
    status: p.message
      ? p.message
      : `${p.name}  ${p.top + 1}-${last}/${p.lines.length}  ${where}`,
  };
}
