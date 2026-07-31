import type { MetadataRoute } from "next";
import { readPosts } from "@/lib/content";
import { SITE_URL } from "@/lib/me";

// output: "export" 下这类约定文件要显式声明，否则构建期报错。
// 它本来也就是构建期生成的，声明只是把事实写出来
export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await readPosts();
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...posts.map((p) => ({
      url: `${SITE_URL}/posts/${p.slug}`,
      lastModified: p.date || undefined,
    })),
  ];
}
