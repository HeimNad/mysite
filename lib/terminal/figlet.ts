// FIGfont (.flf) 解析和渲染。纯函数 —— 字体文本进，字符画出，node --test 直接测。
//
// 字体数据不在包里，装 figlet 的时候才从 /apt/... 取。这是 apt install 输出里
// 那个字节数的来源，也是它值得懒加载的原因：一个字体 30 KB，比整个命令层还大
//
// 格式（figlet 2.2 规范里用得到的那部分）：
//   flf2a$ 6 5 16 15 13 0 24463 229
//     └─magic+hardblank  height baseline maxlen oldlayout commentlines ...
//   接着 commentlines 行注释（作者和许可写在那里，别丢）
//   然后从 ASCII 32 开始每个字符 height 行，行尾是结束符，最后一行是两个

export type Font = {
  height: number;
  /** 硬空格：排版时算"有内容"（所以字母之间不会塌），最后才变成真空格 */
  hardblank: string;
  /** 老式布局位：负数保持原宽，0 及以上把字母推到刚好挨上 */
  layout: number;
  chars: Map<number, string[]>;
};

/**
 * 同一份字体文本只解析一次。解析要跑 30 kB 文本、建 95 个字形，
 * 而 figlet 每敲一次就要用一遍 —— 缓存键就是字体源文本，纯函数照旧
 */
const parsed = new Map<string, Font>();

export function getFont(text: string): Font {
  let font = parsed.get(text);
  if (!font) {
    font = parseFont(text);
    parsed.set(text, font);
  }
  return font;
}

export function parseFont(text: string): Font {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.match(/^flf2a(.)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
  if (!header) throw new Error("不是合法的 FIGfont 文件（缺少 flf2a 头）");

  const hardblank = header[1];
  const height = Number(header[2]);
  const layout = Number(header[5]);
  const comments = Number(header[6]);

  const chars = new Map<number, string[]>();
  let at = 1 + comments;
  // ASCII 32..126 是每个字体都必须提供的那批，后面的码位标记字符用不到
  for (let code = 32; code <= 126; code++) {
    const glyph: string[] = [];
    for (let row = 0; row < height; row++) {
      const line = lines[at++];
      if (line === undefined) return { height, hardblank, layout, chars };
      // 结束符就是这一行的最后一个字符，末行会连写两个 —— 全部剥掉
      const mark = line[line.length - 1];
      let end = line.length;
      while (end > 0 && line[end - 1] === mark) end--;
      glyph.push(line.slice(0, end));
    }
    chars.set(code, glyph);
  }
  return { height, hardblank, layout, chars };
}

/** 整块空白的行不参与限制，否则一个空行就把贴合距离卡死在 0 */
const blank = (s: string) => s.trim() === "";

/**
 * 把下一个字形能往左推多远：每行算"左边的右侧空白 + 右边的左侧空白"，取最小的那行。
 * 这只是"刚好挨上"，真 figlet 还会在此基础上再叠一列并融合，见 smush
 */
function kern(rows: string[], glyph: string[], width: number): number {
  let room = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i] ?? "";
    const r = glyph[i] ?? "";
    if (blank(l) || blank(r)) continue;
    const trailing = width - l.replace(/ +$/, "").length;
    const leading = r.length - r.replace(/^ +/, "").length;
    room = Math.min(room, trailing + leading);
  }
  return Number.isFinite(room) ? room : 0;
}

/** 等级规则用的六个类，越靠后越强 */
const CLASSES = ["|", "/\\", "[]", "{}", "()", "<>"];
const UNDER_TARGETS = "|/\\[]{}()<>";
const OPPOSITE = new Set(["[]", "][", "{}", "}{", "()", ")("]);

/**
 * 两个重叠的子字符能否融合成一个。规则按字体的 layout 位启用 ——
 * Standard 是 15，也就是规则 1（相同）+2（下划线）+4（等级）+8（相对成对）。
 * 融合不了就返回 null，调用方据此少叠一列
 */
function smush(a: string, b: string, hardblank: string, layout: number): string | null {
  if (a === " ") return b;
  if (b === " ") return a;
  // 硬空格是"看不见但占位"，只有两个硬空格在规则 6 下才合并
  if (a === hardblank && b === hardblank) return layout & 32 ? a : null;
  if (a === hardblank || b === hardblank) return null;

  if (layout & 1 && a === b) return a;
  if (layout & 2) {
    if (a === "_" && UNDER_TARGETS.includes(b)) return b;
    if (b === "_" && UNDER_TARGETS.includes(a)) return a;
  }
  if (layout & 4) {
    const ca = CLASSES.findIndex((c) => c.includes(a));
    const cb = CLASSES.findIndex((c) => c.includes(b));
    if (ca >= 0 && cb >= 0 && ca !== cb) return ca > cb ? a : b;
  }
  if (layout & 8 && OPPOSITE.has(a + b)) return "|";
  if (layout & 16) {
    if (a + b === "/\\") return "|";
    if (a + b === "\\/") return "Y";
    if (a + b === "><") return "X";
  }
  return null;
}

/** 按给定的贴合量摆放字形；有一处重叠融合不了就返回 null */
function place(
  rows: string[],
  glyph: string[],
  width: number,
  shift: number,
  font: Font
): string[] | null {
  const offset = width - shift;
  if (offset < 0) return null;
  const gw = Math.max(...glyph.map((g) => g.length));
  const out: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const line = [...(rows[i] ?? "").padEnd(Math.max(width, offset + gw))];
    for (let j = 0; j < gw; j++) {
      const c = glyph[i]?.[j] ?? " ";
      const at = offset + j;
      const existing = line[at] ?? " ";
      if (existing === " ") {
        line[at] = c;
        continue;
      }
      const merged = smush(existing, c, font.hardblank, font.layout);
      if (merged === null) return null;
      line[at] = merged;
    }
    out.push(line.join(""));
  }
  return out;
}

/** 把一行文本渲染成字符画。认不出的字符按空格处理 */
export function renderFiglet(text: string, font: Font): string {
  let rows: string[] = Array.from({ length: font.height }, () => "");
  let first = true;

  for (const ch of text) {
    const glyph = font.chars.get(ch.codePointAt(0)!) ?? font.chars.get(32);
    if (!glyph) continue;

    const gw = Math.max(...glyph.map((g) => g.length));
    const padded = glyph.map((g) => g.padEnd(gw));

    if (first) {
      rows = padded.slice(0, font.height);
      first = false;
      continue;
    }

    const width = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => r.padEnd(width));

    // 先算刚好挨上的距离，再试着多叠一列（融合）—— 融不了就退回只贴合。
    // 这一列之差就是"像 figlet"和"比 figlet 宽一圈"的区别
    const base = font.layout < 0 ? 0 : kern(rows, padded, width);
    rows =
      (font.layout > 0 ? place(rows, padded, width, base + 1, font) : null) ??
      place(rows, padded, width, base, font) ??
      place(rows, padded, width, 0, font)!;
  }

  return rows
    .map((r) => r.split(font.hardblank).join(" ").replace(/ +$/, ""))
    .join("\n");
}
