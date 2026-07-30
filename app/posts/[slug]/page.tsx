import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPost, readPosts } from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";
import { ME } from "@/lib/me";

type Props = { params: Promise<{ slug: string }> };

// 每篇文章构建成静态 HTML
export async function generateStaticParams() {
  return (await readPosts()).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return {};
  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date || undefined,
      authors: [ME.name],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  const html = await renderMarkdown(post.body);

  return (
    <article className="prose">
      <nav className="prose-nav">
        <Link href="/posts">
          <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>cd ../posts
        </Link>
        {post.date && <time dateTime={post.date}>{post.date}</time>}
      </nav>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <footer className="prose-footer">
        <Link href="/posts">← 所有文章 / all articles</Link>
        {" · "}
        <Link href="/">回到终端 / back to the terminal</Link>
      </footer>
    </article>
  );
}
