// RSS 的 XML 构造。放在 lib 里而不是 route 里，这样能测
import { ME, PRIMARY_LANG, SITE_URL } from "../site/me.ts";
import { escapeXml as esc } from "./xml.ts";
import type { Post } from "./content.ts";


export function buildFeed(posts: Post[]): string {
  const items = posts
    .map((p) =>
      [
        "    <item>",
        `      <title>${esc(p.title)}</title>`,
        // URL 也要转义：slug 和站点地址都可能带 & —— 只转义 title 是不够的
        `      <link>${esc(`${SITE_URL}/posts/${p.slug}`)}</link>`,
        `      <guid isPermaLink="true">${esc(`${SITE_URL}/posts/${p.slug}`)}</guid>`,
        p.date ? `      <pubDate>${new Date(p.date).toUTCString()}</pubDate>` : "",
        `      <description>${esc(p.description)}</description>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${ME.name} 的博客 / ${ME.name}'s blog`)}</title>
    <link>${esc(SITE_URL)}</link>
    <description>${esc(`${ME.name} —— ${ME.title.zh} / ${ME.title.en}`)}</description>
    <language>${PRIMARY_LANG === "zh" ? "zh-CN" : "en"}</language>
    <atom:link href="${esc(`${SITE_URL}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}
