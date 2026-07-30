import { readPosts } from "@/lib/content";

export const dynamic = "force-static";

export async function GET() {
  const posts = await readPosts();
  return Response.json(
    posts.map((p) => ({
      slug: p.slug,
      title: p.title,
      date: p.date,
      url: `/posts/${p.slug}`,
    }))
  );
}
