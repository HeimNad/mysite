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
