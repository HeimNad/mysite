// 假文件系统的路径逻辑。纯函数，无 React 依赖 —— 见 shell.test.mts
import { ME } from "../site/me.ts";

/**
 * 目录树，叶子类型可变：
 *  - 服务端 FSDir 的叶子是文件内容
 *  - 客户端 StatDir 的叶子是 null，内容按需从 /api/fs 取
 * isDir 对两者都成立（null 不是对象），所以路径逻辑一套通用
 */
export type Tree<L> = { [name: string]: L | Tree<L> };
export type FSDir = Tree<string>;
export type StatDir = Tree<null>;

/** 家目录。~ 展开到这里，content/ 挂载在这里 */
export const HOME = ["home", ME.user];

export function isDir<L>(node: L | Tree<L> | undefined): node is Tree<L> {
  return typeof node === "object" && node !== null;
}

/** 用户输入的路径 → 从根目录算起的 segment 数组（处理 . .. ~ /） */
export function resolvePath(cwd: string[], path?: string): string[] {
  const p = path ?? "";
  if (!p) return [...cwd];
  const segs = p.startsWith("~") ? [...HOME] : p.startsWith("/") ? [] : [...cwd];
  for (const part of p.replace(/^~/, "").split("/")) {
    if (part === "" || part === ".") continue;
    // 已在根目录时 .. 原地不动，和 bash 的 cd / .. 一致
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  return segs;
}

export function getNode<L>(root: Tree<L>, segs: string[]): L | Tree<L> | undefined {
  let node: L | Tree<L> = root;
  for (const s of segs) {
    if (!isDir(node) || !(s in node)) return undefined;
    node = node[s];
  }
  return node;
}

/** 真实绝对路径，pwd 用 */
export function absPath(segs: string[]): string {
  return "/" + segs.join("/");
}

/** 提示符里显示的路径：家目录及其子目录缩写成 ~，其余显示绝对路径 */
export function promptPath(segs: string[]): string {
  const underHome = HOME.every((h, i) => segs[i] === h);
  if (!underHome) return absPath(segs);
  const rest = segs.slice(HOME.length);
  return rest.length ? "~/" + rest.join("/") : "~";
}

/** 完整树 → 只有结构的树（叶子换成 null），这份才发给客户端 */
export function toStatTree(root: FSDir): StatDir {
  const out: StatDir = {};
  for (const [name, node] of Object.entries(root)) {
    out[name] = isDir(node) ? toStatTree(node) : null;
  }
  return out;
}

/** ls -l 需要的元数据。内容本身不在客户端，所以大小得单独带过来 */
export type FileStat = { size: number; mtime: string };
export type StatMap = Record<string, FileStat>;

/**
 * 完整树 + content/ 的真实 mtime → 每个文件的大小和时间。
 * 生成出来的 rootfs 文件（/etc、/bin…）没有 mtime，用构建时间兜底 ——
 * 那本来也就是它们的诞生时刻
 */
export function toStatMap(
  root: FSDir,
  contentMtimes: Record<string, string>,
  buildTime: string
): StatMap {
  const home = HOME.join("/") + "/";
  const out: StatMap = {};

  // 返回这一层里最新的 mtime，好让目录继承它 —— 真目录的 mtime 也是随内容变的
  const walk = (dir: FSDir, prefix: string[]): string => {
    let newest = "";
    for (const [name, node] of Object.entries(dir)) {
      const segs = [...prefix, name];
      const path = segs.join("/");
      let mtime: string;
      if (isDir(node)) {
        mtime = walk(node, segs);
        out[path] = { size: 4096, mtime }; // 目录大小是编的，4096 是 ext4 的常见值
      } else {
        const rel = path.startsWith(home) ? path.slice(home.length) : null;
        // 字符数而不是字节数：中文按 UTF-8 会算成三倍，看着莫名其妙
        mtime = (rel && contentMtimes[rel]) || buildTime;
        out[path] = { size: [...node].length, mtime };
      }
      if (mtime > newest) newest = mtime; // ISO 字符串按字典序比就是按时间比
    }
    return newest || buildTime;
  };

  walk(root, []);
  return out;
}

/** 完整树 → 路径到内容的扁平表，/api/fs 路由用 */
export function toFileMap(root: FSDir, prefix: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, node] of Object.entries(root)) {
    const segs = [...prefix, name];
    if (isDir(node)) Object.assign(out, toFileMap(node, segs));
    else out[segs.join("/")] = node;
  }
  return out;
}
