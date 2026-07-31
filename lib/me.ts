// ============ 改这个文件 + content/ 目录就是改网站 ============
// 文件内容在 content/ 里，可以用 {{name}} {{email}} {{github}} 等占位符引用这里的值
import type { Msg } from "./i18n.ts";

export const ME = {
  user: "heimnad",
  host: "web",
  name: "Heimnad",
  title: {
    zh: "热爱计算机的大学生",
    en: "a university student who likes computers",
  } satisfies Msg,
  email: "heimnad233@gmail.com",
  github: "https://github.com/heimnad", // 改成你的
};

/** sitemap 和 OG 图需要绝对 URL。有域名后设 NEXT_PUBLIC_SITE_URL 环境变量 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** 这台"机器"自己的名字。shell 名照 Unix 的规矩：全小写、短 */
export const OS_NAME = "FakeOS";
export const SHELL_NAME = "hnsh";
export const SHELL_PATH = `/bin/${SHELL_NAME}`;

/** 版本号由 next.config.ts 在构建期算出来，是 commit hash 而不是手写的 0.x */
export const VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "unknown";
