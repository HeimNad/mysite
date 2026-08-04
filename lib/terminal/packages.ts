// 可以 apt install 的包。纯数据 —— 装的动作在 Ctx.install 里，这里只描述装什么。
//
// url 是真地址：apt 输出里 Get:1 那一行显示它，浏览器能直接打开，站内
// curl 也取得到。所以"下载了 30 kB"不是编的，是那个文件真实的大小
import type { Msg } from "../site/i18n.ts";

export type Pkg = {
  version: string;
  /**
   * 数据包：文件在本站的路径，真的会被 fetch，浏览器也能直接打开。
   * 代码包没有这个字段 —— 它的载荷是一个 chunk，地址由打包器决定，
   * 装的时候现取（见 terminal.tsx 的 installPkg）
   */
  path?: string;
  /** apt 输出里的"解压后占用" */
  installedSize: number;
  desc: Msg;
};

export const PACKAGES: Record<string, Pkg> = {
  // 分包的标准就一条：真 Ubuntu 装不装。coreutils（sort/cut/tr/uniq）和 less
  // 每台机器都有，做成包反而不像真的；vim 和 htop 恰恰是装完系统第一批要敲
  // apt install 的东西
  vim: {
    version: "2:9.1.0016-1",
    installedSize: 3_500_000,
    desc: { zh: "Vi IMproved 文本编辑器", en: "Vi IMproved - enhanced vi editor" },
  },
  htop: {
    version: "3.3.0-4",
    installedSize: 350_000,
    desc: { zh: "交互式进程查看器", en: "interactive processes viewer" },
  },
  figlet: {
    version: "2.2.5-3",
    path: "/apt/pool/universe/f/figlet/figlet_2.2.5-3.flf",
    installedSize: 61440,
    desc: {
      zh: "把普通文本变成大号字符画",
      en: "make large letters out of ordinary text",
    },
  },
};

/** apt 的字节数格式：30740 → "30.7 kB"，和 apt 一样用 kB 不是 KiB */
export function aptSize(bytes: number): string {
  return bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toFixed(1)} kB`;
}
