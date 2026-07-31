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
      modifiedTime: post.updated || undefined,
      authors: [ME.name],
      // 文章自带图就用它，否则回落到站点那张
      ...(post.image ? { images: [post.image] } : {}),
    },
    ...(post.tags.length ? { keywords: post.tags } : {}),
  };
}

export default async function PostPage({ params }: Props) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  const html = await renderMarkdown(post.body);

  return (
    <article className="prose" lang={post.lang === "zh" ? "zh-CN" : "en"}>
      <nav className="prose-nav">
        <Link href="/posts">
          <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>cd ../posts
        </Link>
        <span className="post-meta">
          {post.date && <time dateTime={post.date}>{post.date}</time>}
          {post.updated && (
            <time dateTime={post.updated} title="最后更新 / last updated">
              {` (↻ ${post.updated})`}
            </time>
          )}
          {post.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </span>
      </nav>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <footer className="prose-footer">
        <Link href="/posts">
          <span className="zh">← 所有文章</span>
          <span className="en">← All articles</span>
        </Link>
        {" · "}
        <Link href="/">
          <span className="zh">回到终端</span>
          <span className="en">Back to the terminal</span>
        </Link>
      </footer>
    </article>
  );
}
