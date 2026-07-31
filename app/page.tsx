import Link from "next/link";
import { getNode, HOME, toStatMap, toStatTree } from "@/lib/fs";
import { contentMtimes, readPosts, readRootfs } from "@/lib/content";
import { ME } from "@/lib/me";
import Terminal from "./terminal";

// 服务端组件：构建期读 content/，但只把目录结构发给客户端 ——
// 文件正文由 cat 通过 /api/fs 按需取，首页 payload 不随文章数量增长
export default async function Home() {
  const [root, posts, mtimes] = await Promise.all([
    readRootfs(),
    readPosts(),
    contentMtimes(),
  ]);
  const meta = posts.map(({ slug, title, date, lang, tags }) => ({ slug, title, date, lang, tags }));
  // ls -l 要的大小和时间。内容本身不发给客户端，所以大小得单独带
  const stats = toStatMap(root, mtimes, new Date().toISOString());
  const about = getNode(root, [...HOME, "about.txt"]);
  const aboutEn = getNode(root, [...HOME, "about.en.txt"]);

  return (
    <>
      <Terminal root={toStatTree(root)} posts={meta} stats={stats} />
      {/* 终端要 JS 才能用，爬虫和禁用 JS 的访客至少能看到这些 */}
      <noscript>
        <div className="prose">
          <h1>{ME.name}</h1>
          <p>
            {ME.title.zh} / {ME.title.en}
          </p>
          {typeof about === "string" && <p style={{ whiteSpace: "pre-wrap" }}>{about}</p>}
          {typeof aboutEn === "string" && <p style={{ whiteSpace: "pre-wrap" }}>{aboutEn}</p>}

          <h2>文章 / Articles</h2>
          <ul>
            {posts.map((p) => (
              <li key={p.slug}>
                <Link href={`/posts/${p.slug}`}>{p.title}</Link>
                {p.date && ` — ${p.date}`}
              </li>
            ))}
          </ul>

          <h2>联系 / Contact</h2>
          <ul>
            <li>
              <a href={`mailto:${ME.email}`}>{ME.email}</a>
            </li>
            <li>
              <a href={ME.github}>{ME.github}</a>
            </li>
          </ul>

          <p>
            这个站点的主体是一个终端模拟器，需要 JavaScript。文章可以直接读：
            <Link href="/posts">/posts</Link>
          </p>
          <p>
            The main site is a terminal emulator and needs JavaScript. The articles are
            readable without it: <Link href="/posts">/posts</Link>
          </p>
        </div>
      </noscript>
    </>
  );
}
