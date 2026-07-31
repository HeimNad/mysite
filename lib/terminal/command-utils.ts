// 命令共用的逻辑。抽出来是为了让 commands.ts 只剩那张表 —— 逻辑和数据是两回事。
// 这里 import 的 Ctx 是纯类型，运行期会被抹掉，所以和 commands.ts 之间没有循环依赖
import { getNode, HOME, isDir, resolvePath, type FileStat, type StatDir } from "./fs.ts";
import { ME } from "../site/me.ts";
import type { Ctx } from "./commands.ts";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/**
 * 命令要么读文件参数，要么读 stdin —— 和真 coreutils 一样。
 * 存在性和目录判断先在结构树上做完，错误信息不变，也省掉无谓的请求
 */
export async function readInput(
  args: string[],
  stdin: string | null,
  ctx: Ctx,
  cmd: string
): Promise<string> {
  const files = args.filter((a) => !a.startsWith("-"));
  if (!files.length) {
    if (stdin === null)
      throw new Error(
        ctx.t(
          `${cmd}: 缺少文件名（或用管道喂给它）`,
          `${cmd}: missing file operand (or pipe something into it)`
        )
      );
    return stdin;
  }
  const bodies = await Promise.all(
    files.map((f) => {
      const segs = resolvePath(ctx.cwd, f);
      const node = getNode(ctx.root, segs);
      if (node === undefined)
        throw new Error(
          ctx.t(`${cmd}: ${f}: 没有那个文件或目录`, `${cmd}: ${f}: No such file or directory`)
        );
      if (isDir(node))
        throw new Error(ctx.t(`${cmd}: ${f}: 是一个目录`, `${cmd}: ${f}: Is a directory`));
      return ctx.read(segs);
    })
  );
  return bodies.join("\n");
}

/**
 * 取出 -n 5 或 -5 的行数，并把消耗掉的 token 从参数里摘走
 * —— 不摘走的话 readInput 会把 "5" 当成文件名
 */
export function takeNum(args: string[], fallback: number): { n: number; rest: string[] } {
  const i = args.indexOf("-n");
  if (i >= 0 && args[i + 1] !== undefined) {
    const n = Number(args[i + 1]);
    return {
      n: Number.isFinite(n) ? n : fallback,
      rest: [...args.slice(0, i), ...args.slice(i + 2)],
    };
  }
  const bare = args.find((a) => /^-\d+$/.test(a));
  return bare
    ? { n: Number(bare.slice(1)), rest: args.filter((a) => a !== bare) }
    : { n: fallback, rest: args };
}

/** 目录项按字母序 —— 真 ls 就是排序的，别暴露对象的插入顺序 */
export function entries(dir: StatDir, showAll: boolean): string[] {
  return Object.keys(dir)
    .filter((n) => showAll || !n.startsWith("."))
    .sort((a, b) => a.localeCompare(b));
}

export function treeLines(dir: StatDir, showAll: boolean, prefix = ""): string[] {
  const names = entries(dir, showAll);
  return names.flatMap((name, i) => {
    const last = i === names.length - 1;
    const node = dir[name];
    const line = prefix + (last ? "└── " : "├── ") + name + (isDir(node) ? "/" : "");
    return isDir(node)
      ? [line, ...treeLines(node, showAll, prefix + (last ? "    " : "│   "))]
      : [line];
  });
}

/** ls -l 的日期列：Jul 29 20:33。按 UTC 格式化，各地看到的一样 */
export function lsDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** ls -l 的一行。权限是编的，但和"这里的一切都是只读的"保持一致 */
export function longLine(
  name: string,
  node: StatDir[string],
  stat: FileStat | undefined
): string {
  const dir = isDir(node);
  return [
    dir ? "dr-xr-xr-x" : "-r--r--r--",
    String(dir ? Object.keys(node).length + 2 : 1).padStart(2),
    `${ME.user} ${ME.user}`,
    String(stat?.size ?? 0).padStart(6),
    lsDate(stat?.mtime ?? new Date(0).toISOString()),
    name + (dir ? "/" : ""),
  ].join(" ");
}

/** 统计文件系统里有多少文件、多少字节 —— 登录横幅的 Filesystem 行要真值 */
export function fsUsage(
  dir: StatDir,
  stats: Record<string, FileStat>,
  prefix: string[] = []
): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const [name, node] of Object.entries(dir)) {
    const segs = [...prefix, name];
    if (isDir(node)) {
      const sub = fsUsage(node, stats, segs);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files += 1;
      bytes += stats[segs.join("/")]?.size ?? 0;
    }
  }
  return { files, bytes };
}

/** 1234 → "1.2 kB"。给横幅用，不追求精确 */
export function humanSize(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
}

/** 登录时间戳：Wed Jul 30 18:42:11 2026，和 lastlog 的格式一致 */
export function loginDate(d: Date): string {
  const days = "Sun Mon Tue Wed Thu Fri Sat".split(" ");
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}`
  );
}

/**
 * 读家目录下的某个文件，不受 cwd 影响。
 * 英文下优先读 xxx.en.txt，没有就退回中文 —— 内容按文件自愿翻译，不强制对等
 */
export function homeFile(ctx: Ctx, name: string): Promise<string> {
  const candidates = ctx.lang === "en" ? [name.replace(/\.txt$/, ".en.txt"), name] : [name];
  for (const c of candidates) {
    const segs = [...HOME, c];
    if (getNode(ctx.root, segs) !== undefined) return ctx.read(segs);
  }
  throw new Error(ctx.t(`~/${name}: 没有那个文件`, `~/${name}: No such file`));
}
