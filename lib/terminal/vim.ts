// vim 的状态机。纯函数：状态 + 按键 → 新状态，node --test 直接跑。
//
// 文件系统是只读的，所以 :w 一定失败 —— 但这不是缩水，真 vim 就允许你改
// 只读缓冲区，只在保存时拦你（E45）。能编辑、不能保存，是准确的行为。
//
// 键位只做常用的那一批。真 vim 有几百个，堆全了既测不完也没人用

export type VimMode = "normal" | "insert" | "command";

export type Vim = {
  lines: string[];
  row: number;
  col: number;
  mode: VimMode;
  /** : 之后正在输入的那行 */
  cmdline: string;
  name: string;
  dirty: boolean;
  message: string;
  rows: number;
  /** 视口第一行 */
  top: number;
  /** 多键序列的前缀：g、d 之类按下之后在等第二个键 */
  pending: string;
  undo: Snapshot[];
};

type Snapshot = { lines: string[]; row: number; col: number };

export function openVim(text: string, name: string, rows: number): Vim {
  return {
    lines: text.split("\n"),
    row: 0,
    col: 0,
    mode: "normal",
    cmdline: "",
    name,
    dirty: false,
    message: `"${name}" ${text.split("\n").length}L, ${text.length}B`,
    rows: Math.max(3, rows),
    top: 0,
    pending: "",
    undo: [],
  };
}

const line = (v: Vim) => v.lines[v.row] ?? "";
const snap = (v: Vim): Snapshot => ({ lines: [...v.lines], row: v.row, col: v.col });

/** 光标不能跑出内容之外。normal 模式停在最后一个字符上，insert 可以到末尾之后 */
function clampCursor(v: Vim): Vim {
  const row = Math.max(0, Math.min(v.lines.length - 1, v.row));
  const len = (v.lines[row] ?? "").length;
  const max = v.mode === "insert" ? len : Math.max(0, len - 1);
  return { ...v, row, col: Math.max(0, Math.min(max, v.col)) };
}

/** 光标始终留在视口里 —— 走出去就把视口跟着挪 */
function scroll(v: Vim): Vim {
  const body = v.rows - 1; // 末行留给状态行
  if (v.row < v.top) return { ...v, top: v.row };
  if (v.row >= v.top + body) return { ...v, top: v.row - body + 1 };
  return v;
}

const settle = (v: Vim) => scroll(clampCursor(v));

/** 在光标处插入一段文本。输入法合成完的整串也走这里 */
export function insertText(v: Vim, text: string): Vim {
  if (!text) return v;
  const parts = text.split("\n");
  const cur = line(v);
  const before = cur.slice(0, v.col);
  const after = cur.slice(v.col);

  if (parts.length === 1) {
    const lines = [...v.lines];
    lines[v.row] = before + text + after;
    return settle({ ...v, lines, col: v.col + text.length, dirty: true });
  }
  const lines = [...v.lines];
  lines.splice(v.row, 1, before + parts[0], ...parts.slice(1, -1), parts[parts.length - 1] + after);
  return settle({
    ...v,
    lines,
    row: v.row + parts.length - 1,
    col: parts[parts.length - 1].length,
    dirty: true,
  });
}

/** :q :q! :w :wq 之类。返回 null 表示退出 vim */
function runCommand(v: Vim, cmd: string): Vim | null {
  const c = cmd.trim();
  const base = { ...v, mode: "normal" as const, cmdline: "" };

  if (c === "q") {
    if (v.dirty)
      return { ...base, message: "E37: No write since last change (add ! to override)" };
    return null;
  }
  if (c === "q!" || c === "qa!" || c === "qa") return null;

  if (c === "w" || c === "wq" || c === "x" || c === "w!" || c === "wq!") {
    // 这台机器的文件系统真的是只读的，所以照实报 vim 的只读错误
    return { ...base, message: "E45: 'readonly' option is set (add ! to override)" };
  }
  if (/^\d+$/.test(c)) return settle({ ...base, row: Number(c) - 1, col: 0 });
  return { ...base, message: `E492: Not an editor command: ${c}` };
}

/** 一个按键。返回 null 表示 vim 退出，键盘还给提示符 */
export function vimKey(v: Vim, key: string): Vim | null {
  if (v.mode === "command") {
    if (key === "Enter") return runCommand(v, v.cmdline);
    if (key === "Escape") return { ...v, mode: "normal", cmdline: "", message: "" };
    if (key === "Backspace") {
      if (!v.cmdline) return { ...v, mode: "normal", message: "" };
      return { ...v, cmdline: v.cmdline.slice(0, -1) };
    }
    return key.length === 1 ? { ...v, cmdline: v.cmdline + key } : v;
  }

  if (v.mode === "insert") {
    if (key === "Escape") return settle({ ...v, mode: "normal", col: Math.max(0, v.col - 1) });
    if (key === "Enter") return insertText(v, "\n");
    if (key === "Backspace") {
      if (v.col > 0) {
        const lines = [...v.lines];
        lines[v.row] = line(v).slice(0, v.col - 1) + line(v).slice(v.col);
        return settle({ ...v, lines, col: v.col - 1, dirty: true });
      }
      if (v.row === 0) return v;
      // 行首退格：和上一行接起来
      const lines = [...v.lines];
      const prev = lines[v.row - 1];
      lines.splice(v.row - 1, 2, prev + lines[v.row]);
      return settle({ ...v, lines, row: v.row - 1, col: prev.length, dirty: true });
    }
    if (key.length === 1) return insertText(v, key);
    // 方向键在 insert 里照常移动
    return normalMotion(v, key) ?? v;
  }

  // ---- normal ----
  if (v.pending) {
    const seq = v.pending + key;
    const cleared = { ...v, pending: "", message: "" };
    if (seq === "gg") return settle({ ...cleared, row: 0, col: 0 });
    if (seq === "dd") {
      const lines = [...v.lines];
      lines.splice(v.row, 1);
      return settle({
        ...cleared,
        undo: [...v.undo, snap(v)],
        lines: lines.length ? lines : [""],
        dirty: true,
      });
    }
    return cleared;
  }

  const moved = normalMotion(v, key);
  if (moved) return moved;

  switch (key) {
    case "g":
    case "d":
      return { ...v, pending: key };
    case "i":
      return settle({ ...v, mode: "insert", message: "" });
    case "a":
      return settle({ ...v, mode: "insert", col: v.col + 1, message: "" });
    case "I":
      return settle({ ...v, mode: "insert", col: 0, message: "" });
    case "A":
      return settle({ ...v, mode: "insert", col: line(v).length, message: "" });
    case "o": {
      const lines = [...v.lines];
      lines.splice(v.row + 1, 0, "");
      return settle({
        ...v, undo: [...v.undo, snap(v)], lines,
        row: v.row + 1, col: 0, mode: "insert", dirty: true, message: "",
      });
    }
    case "O": {
      const lines = [...v.lines];
      lines.splice(v.row, 0, "");
      return settle({
        ...v, undo: [...v.undo, snap(v)], lines,
        col: 0, mode: "insert", dirty: true, message: "",
      });
    }
    case "x": {
      if (!line(v)) return v;
      const lines = [...v.lines];
      lines[v.row] = line(v).slice(0, v.col) + line(v).slice(v.col + 1);
      return settle({ ...v, undo: [...v.undo, snap(v)], lines, dirty: true });
    }
    case "u": {
      const last = v.undo[v.undo.length - 1];
      if (!last) return { ...v, message: "Already at oldest change" };
      return settle({ ...v, ...last, undo: v.undo.slice(0, -1), message: "1 change; before" });
    }
    case ":":
      return { ...v, mode: "command", cmdline: "", message: "" };
    case "G":
      return settle({ ...v, row: v.lines.length - 1, col: 0 });
    case "ZZ":
      return null;
    default:
      return v;
  }
}

/** 光标移动。认得就返回新状态，认不得返回 null 交给上面继续判 */
function normalMotion(v: Vim, key: string): Vim | null {
  switch (key) {
    case "h":
    case "ArrowLeft":
      return settle({ ...v, col: v.col - 1 });
    case "l":
    case "ArrowRight":
      return settle({ ...v, col: v.col + 1 });
    case "j":
    case "ArrowDown":
      return settle({ ...v, row: v.row + 1 });
    case "k":
    case "ArrowUp":
      return settle({ ...v, row: v.row - 1 });
    case "0":
    case "Home":
      return settle({ ...v, col: 0 });
    case "$":
    case "End":
      return settle({ ...v, col: line(v).length - 1 });
    case "w": {
      const rest = line(v).slice(v.col);
      const skip = /^\S*\s*/.exec(rest)?.[0].length ?? 0;
      if (v.col + skip >= line(v).length && v.row < v.lines.length - 1)
        return settle({ ...v, row: v.row + 1, col: 0 });
      return settle({ ...v, col: v.col + Math.max(1, skip) });
    }
    case "b": {
      if (v.col === 0) {
        if (v.row === 0) return settle(v);
        // 回上一行"最后一个词的词首"，不是行尾 —— b 的语义是退到词首
        const prev = v.lines[v.row - 1] ?? "";
        return settle({ ...v, row: v.row - 1, col: /\S*\s*$/.exec(prev)?.index ?? 0 });
      }
      const before = line(v).slice(0, v.col);
      const back = /\S*\s*$/.exec(before)?.[0].length ?? 0;
      return settle({ ...v, col: v.col - Math.max(1, back) });
    }
    default:
      return null;
  }
}

/** 视口里的内容 + 状态行 + 光标在视口里的位置 */
export function vimView(v: Vim): {
  body: string[];
  status: string;
  cursor: { row: number; col: number };
} {
  const body = v.lines.slice(v.top, v.top + v.rows - 1);
  // 真 vim 用 ~ 标记文件结束之后的行
  while (body.length < v.rows - 1) body.push("~");

  const status =
    v.mode === "command"
      ? ":" + v.cmdline
      : v.message
        ? v.message
        : (v.mode === "insert" ? "-- INSERT --" : `"${v.name}"${v.dirty ? " [+]" : ""}`) +
          `        ${v.row + 1},${v.col + 1}`;

  return { body, status, cursor: { row: v.row - v.top, col: v.col } };
}
