import type { Metadata } from "next";
import Link from "next/link";
import { readPosts } from "@/lib/content/content";
import { ME } from "@/lib/site/me";

export const metadata: Metadata = {
  title: "文章 / Articles",
  description: `${ME.name} 写的东西 / Things ${ME.name} has written`,
};

// 静态页拿不到客户端选的语言，所以标题类文字两种都印
export default async function PostsIndex() {
  const posts = await readPosts();

  return (
    <div className="prose">
      <nav className="prose-nav">
        <Link href="/">
          <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>cd ~
        </Link>
        <a href="/feed.xml">RSS</a>
      </nav>

      <h1>
        <span className="zh">文章</span>
        <span className="en">Articles</span>
      </h1>

      {posts.length === 0 ? (
        <p>
          <span className="zh">还没写。往 content/posts/ 里丢一个 .md 就有了。</span>
          <span className="en">Nothing yet. Drop a .md into content/posts/.</span>
        </p>
      ) : (
        <>
          {posts.every((p) => p.lang === "zh") && (
            <p className="dim">
              <span className="zh">文章目前只有中文。</span>
              <span className="en">The articles are in Chinese only for now.</span>
            </p>
          )}
          <ul className="post-list">
            {posts.map((p) => (
              <li key={p.slug}>
                <Link href={`/posts/${p.slug}`}>{p.title}</Link>
                {p.date && (
                  <time dateTime={p.date}>
                    {p.date}
                    {p.updated && ` (↻ ${p.updated})`}
                  </time>
                )}
                {p.tags.length > 0 && (
                  <span className="post-meta">
                    {p.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
                <p>{p.description}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
