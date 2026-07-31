// ============ 改这个文件 + content/ 目录就是改网站 ============
// 文件内容在 content/ 里，可以用 {{name}} {{email}} {{github}} 等占位符引用这里的值
import type { Lang, Msg } from "./i18n.ts";

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

/**
 * 站点地址。填 heimnad.com 或 https://heimnad.com 都行，尾斜杠也会去掉 ——
 * 少写协议的话 new URL() 会抛 Invalid URL，而 Next 把它报成
 * "Failed to collect configuration for /_not-found"，完全指不到正地方
 */
export function normalizeSiteUrl(raw: string | undefined): string {
  const s = raw?.trim();
  if (!s) return "http://localhost:3000";
  const withProtocol = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    // origin 顺手去掉尾斜杠和路径，否则会拼出 https://x.com//posts/y
    return new URL(withProtocol).origin;
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL 不是合法地址: ${JSON.stringify(raw)}。` +
        `写成 heimnad.com 或 https://heimnad.com`
    );
  }
}

/** sitemap、RSS 和 OG 图需要绝对 URL。有域名后设 NEXT_PUBLIC_SITE_URL 环境变量 */
export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/** 这台"机器"自己的名字。shell 名照 Unix 的规矩：全小写、短 */
/** 文章没写 lang 时按这个算。fork 这个项目的人改这里 */
export const PRIMARY_LANG: Lang = "zh";

export const OS_NAME = "FakeOS";
export const SHELL_NAME = "hnsh";
export const SHELL_PATH = `/bin/${SHELL_NAME}`;

/** 版本号由 next.config.ts 在构建期算出来，是 commit hash 而不是手写的 0.x */
export const VERSION = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "unknown";
