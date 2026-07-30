import { readPosts } from "@/lib/content";
import { buildFeed } from "@/lib/feed";

export const dynamic = "force-static"; // 构建期生成，不要每次请求都读盘

export async function GET() {
  return new Response(buildFeed(await readPosts()), {
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}
