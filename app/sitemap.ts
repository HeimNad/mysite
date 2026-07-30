import type { MetadataRoute } from "next";
import { readPosts } from "@/lib/content";
import { SITE_URL } from "@/lib/me";

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
