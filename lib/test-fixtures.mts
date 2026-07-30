// 测试共用的夹具。文件名不含 .test.mts，所以 node --test 不会把它当测试跑
import assert from "node:assert/strict";
import { getNode, HOME, toStatMap, toStatTree, type FSDir } from "./fs.ts";
import { execute } from "./shell.ts";
import { ME } from "./me.ts";
import type { Ctx, PostMeta } from "./commands.ts";
import type { Lang } from "./i18n.ts";

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

/**
 * 从完整树造出 ctx：结构树给命令，read 直接从完整树取 ——
 * 生产环境这一步是 fetch /api/fs，行为等价
 */
export function ctxOf(
  full: FSDir,
  cwd: string[] = at(),
  posts: PostMeta[] = [],
  lang: Lang = "zh"
): Omit<Ctx, "piped"> {
  return {
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
