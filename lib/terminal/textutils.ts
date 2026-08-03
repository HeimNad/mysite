// sort / uniq / cut / tr 的实现。纯函数，node --test 直接跑。
//
// 这个站最能打的地方是"管道是真的"，但管道两头能接的东西一直太少。
// 这四个是 coreutils 里最常出现在管道中间的，加上之后这句真的能跑：
//   cat skills.txt | cut -d: -f1 | sort | uniq -c
//
// 行为照抄真命令，尤其 uniq —— 它只合并**相邻**的重复行，
// 这正是"为什么要先 sort 再 uniq"的原因。做成全局去重就把这个道理弄丢了

export type SortOpts = { numeric?: boolean; reverse?: boolean; unique?: boolean };

export function sortLines(lines: string[], o: SortOpts = {}): string[] {
  const cmp = o.numeric
    ? (a: string, b: string) => (parseFloat(a) || 0) - (parseFloat(b) || 0)
    : (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const out = [...lines].sort((a, b) => (o.reverse ? -cmp(a, b) : cmp(a, b)));
  // -u 在排序之后去重，所以它去的是全局重复 —— 和 uniq 不一样
  return o.unique ? out.filter((l, i) => i === 0 || l !== out[i - 1]) : out;
}

export type UniqOpts = { count?: boolean; onlyDup?: boolean; onlyUniq?: boolean };

/** 只合并**相邻**的重复行 —— 真 uniq 就是这样，所以才要先 sort */
export function uniqLines(lines: string[], o: UniqOpts = {}): string[] {
  const runs: { line: string; n: number }[] = [];
  for (const line of lines) {
    const last = runs[runs.length - 1];
    if (last && last.line === line) last.n++;
    else runs.push({ line, n: 1 });
  }
  return runs
    .filter((r) => (o.onlyDup ? r.n > 1 : o.onlyUniq ? r.n === 1 : true))
    .map((r) => (o.count ? `${String(r.n).padStart(7)} ${r.line}` : r.line));
}

/** "1,3-5" → [1,3,4,5]。编号从 1 开始，和 cut 一致 */
export function parseRanges(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^(\d*)-(\d*)$/.exec(part);
    if (m) {
      const from = m[1] ? Number(m[1]) : 1;
      const to = m[2] ? Number(m[2]) : 200; // 开区间给个上限，别去猜行长
      for (let i = from; i <= to; i++) out.add(i);
    } else if (/^\d+$/.test(part)) out.add(Number(part));
  }
  return [...out].sort((a, b) => a - b);
}

export type CutOpts = { delim?: string; fields?: string; chars?: string };

export function cutLine(line: string, o: CutOpts): string {
  if (o.chars) {
    // 按字符数不是码元数 —— 中文一个字算一个
    const cs = [...line];
    return parseRanges(o.chars)
      .map((i) => cs[i - 1] ?? "")
      .join("");
  }
  const delim = o.delim ?? "\t";
  // 真 cut 遇到不含分隔符的行会整行输出，除非给了 -s
  if (!line.includes(delim)) return line;
  const parts = line.split(delim);
  return parseRanges(o.fields ?? "1")
    .map((i) => parts[i - 1])
    .filter((p) => p !== undefined)
    .join(delim);
}

/** tr 的集合：a-z 展开，\n \t \\ 认转义 */
export function expandSet(spec: string): string[] {
  const chars: string[] = [];
  const src = [...spec];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\\" && i + 1 < src.length) {
      const esc = src[++i];
      chars.push(esc === "n" ? "\n" : esc === "t" ? "\t" : esc);
      continue;
    }
    // a-z 这种区间，两边都得是单个字符
    if (src[i + 1] === "-" && src[i + 2] !== undefined && src[i + 2] !== "\\") {
      const from = src[i].codePointAt(0)!;
      const to = src[i + 2].codePointAt(0)!;
      if (from <= to) {
        for (let c = from; c <= to; c++) chars.push(String.fromCodePoint(c));
        i += 2;
        continue;
      }
    }
    chars.push(src[i]);
  }
  return chars;
}

export type TrOpts = { delete?: boolean; squeeze?: boolean };

export function trText(text: string, set1: string, set2: string, o: TrOpts = {}): string {
  const from = expandSet(set1);
  const to = expandSet(set2);
  const out: string[] = [];
  let lastMapped = "";

  for (const ch of text) {
    const i = from.indexOf(ch);
    if (i < 0) {
      out.push(ch);
      lastMapped = "";
      continue;
    }
    if (o.delete) continue;
    // set2 比 set1 短时，多出来的都映射到 set2 最后一个字符 —— 和真 tr 一样
    const mapped = to.length ? (to[i] ?? to[to.length - 1]) : ch;
    if (o.squeeze && mapped === lastMapped) continue;
    out.push(mapped);
    lastMapped = mapped;
  }
  return out.join("");
}
