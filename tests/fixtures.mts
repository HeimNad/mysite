// 测试共用的夹具。文件名不含 .test.mts，所以 node --test 不会把它当测试跑
import assert from "node:assert/strict";
import { getNode, HOME, toStatMap, toStatTree, type FSDir } from "../lib/terminal/fs.ts";
import { execute } from "../lib/terminal/shell.ts";
import { ME } from "../lib/site/me.ts";
import type { Ctx, PostMeta } from "../lib/terminal/commands.ts";
import { INIT_PID, type Proc } from "../lib/terminal/procs.ts";
import type { Machine } from "../lib/terminal/procfs.ts";
import type { Lang } from "../lib/site/i18n.ts";

/** 测试用的树，挂在家目录下，和真实结构一致 */
export const FIXTURE: FSDir = {
  "a.txt": "alpha\nbeta\nGamma",
  dir: { "b.txt": "one\ntwo", sub: { "c.txt": "deep" } },
  ".hidden": "secret",
};
export const ROOT: FSDir = { home: { [ME.user]: FIXTURE }, etc: { hostname: "web" } };

/** 家目录下的相对位置 → 绝对 segments */
export const at = (...rest: string[]) => [...HOME, ...rest];

/** 固定时间，让 ls -l 的断言可重复 */
export const FIXED_TIME = "2026-07-29T20:33:00.000Z";

/** 固定的单调时钟读数，ps 的 ELAPSED 断言靠它可重复 */
export const FIXED_NOW = 83_000; // 1 分 23 秒

/** 固定的往返时延，ping 的断言才可重复 */
export const FIXED_RTT = 12.5;

/**
 * 固定的机器参数。故意留一半是 null —— Safari 上 deviceMemory 和
 * performance.memory 就是拿不到，测试得覆盖那一半
 */
export const FIXED_MACHINE: Machine = {
  cores: 4,
  memoryGB: 8,
  heapUsed: 10 * 1024 * 1024,
  heapLimit: 2 * 1024 ** 3,
  storageQuota: 3 * 1024 ** 3,
  storageUsage: 1536,
  uptimeMs: FIXED_NOW,
  platform: "Macintosh",
};

/**
 * 从完整树造出 ctx：结构树给命令，read 直接从完整树取 ——
 * 生产环境这一步是 fetch /api/fs，行为等价
 */
export function ctxOf(
  full: FSDir,
  cwd: string[] = at(),
  posts: PostMeta[] = [],
  lang: Lang = "zh",
  /** 已装的包。默认什么都没装，和新访客一致 */
  pkgs: Map<string, string> = new Map(),
  /** 正在跑的进程。默认只有 shell 自己，和刚开页面一致 */
  procs: Proc[] = [{ pid: INIT_PID, cmd: "hnsh", startedAt: 0 }],
  /** kill 掉的 pid 和 panic 的消息记在这里，供断言 */
  killed: number[] = [],
  panics: string[] = [],
  machine: Machine = FIXED_MACHINE,
  /** less 分页的内容记在这里，供断言 */
  paged: { text: string; name: string }[] = [],
  /** vim 打开的内容记在这里，供断言 */
  edited: { text: string; name: string }[] = [],
  /** htop 打开过几次，供断言 */
  monitored: boolean[] = [],
  /** pbcopy 写进剪贴板的内容，供断言 */
  copied: string[] = []
): Omit<Ctx, "piped"> {
  return {
    pkgs,
    asRoot: false,
    // 进程表：测试里给一个可控的表，kill 记下被杀的 pid 供断言
    procs,
    kill: (pid) => {
      killed.push(pid);
      const i = procs.findIndex((p) => p.pid === pid);
      if (i >= 0) procs.splice(i, 1);
    },
    // 固定时钟，ELAPSED 的断言才可重复
    now: () => FIXED_NOW,
    panic: (m) => panics.push(m),
    machine: async () => machine,
    page: (text, name) => paged.push({ text, name }),
    edit: (text, name) => edited.push({ text, name }),
    clipboard: async (text) => {
      copied.push(text);
    },
    probe: async () => FIXED_RTT,
    monitor: () => {
      monitored.push(true);
    },
    // 测试里不发请求，直接把内容塞进去，并报一个固定的字节数和耗时
    install: async (name) => {
      const body = `installed:${name}`;
      pkgs.set(name, body);
      return { bytes: body.length, ms: 1 };
    },
    uninstall: (name) => {
      pkgs.delete(name);
    },
    root: toStatTree(full),
    stats: toStatMap(full, {}, FIXED_TIME),
    cwd,
    lang,
    setLang: () => {},
    t: (zh, en) => (lang === "zh" ? zh : en),
    setCwd: () => {},
    clear: () => {},
    openUrl: () => {},
    toggleTheme: () => {},
    read: async (segs) => {
      const node = getNode(full, segs);
      if (typeof node !== "string") throw new Error(`read: /${segs.join("/")}: 不是文件`);
      return node;
    },
    // 测试里不发真请求，只把拿到的路径回显出来，方便断言 curl 传对了什么
    http: async (path) => `GET ${path}`,
    history: [],
    posts,
  };
}

/** 跑一条命令并断言它没报错，返回输出 */
export function runner(full: FSDir) {
  return async (cmd: string, cwd: string[] = at()) => {
    const r = await execute(cmd, ctxOf(full, cwd));
    assert.equal(r.error, undefined, `意外报错: ${r.error}`);
    return r.output as string;
  };
}

/** 跑一条命令并返回它的错误信息（断言用） */
export function errorOf(full: FSDir) {
  return async (cmd: string, cwd: string[] = at()) =>
    (await execute(cmd, ctxOf(full, cwd))).error;
}
