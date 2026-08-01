// 服务端：读 content/ 目录、rootfs 骨架、博客（frontmatter/markdown/RSS）、按需加载
import { test } from "node:test";
import assert from "node:assert/strict";
import { getNode, isDir, toFileMap, toStatTree } from "../lib/terminal/fs.ts";
import { execute } from "../lib/terminal/shell.ts";
import { getPost, parseFrontmatter, readContent, readPosts, readRootfs } from "../lib/content/content.ts";
import { ME } from "../lib/site/me.ts";
import type { PostMeta } from "../lib/terminal/commands.ts";
import { at, ctxOf } from "./fixtures.mts";

test("readContent 读盘：目录嵌套、剥 frontmatter、插值 {{...}}", async () => {
  const root = await readContent();

  assert.ok(isDir(root.projects), "projects/ 应该是目录");
  assert.ok(isDir(root.posts), "posts/ 应该是目录");
  assert.ok(!(".DS_Store" in root), "macOS 垃圾文件不该进文件系统");

  const post = getNode(root, ["posts", "why-a-terminal.md"]) as string;
  assert.doesNotMatch(post, /^---/, "frontmatter 必须剥掉");
  assert.doesNotMatch(post, /title:/, "frontmatter 的字段不该漏出来");
  assert.match(post, /^# 为什么我的网站是个终端/);

  const contact = getNode(root, ["contact.txt"]) as string;
  assert.match(contact, new RegExp(ME.email), "{{email}} 应该被替换");
  assert.doesNotMatch(contact, /\{\{/, "不该有残留的占位符");
});

test("占位符不会渲染成 [object Object]", async () => {
  // ME.title 从字符串变成 { zh, en } 之后，{{title}} 曾经悄悄渲染成了 [object Object]
  for (const [path, body] of Object.entries(toFileMap(await readRootfs()))) {
    assert.doesNotMatch(body, /\[object \w+\]/, `/${path} 里有没渲染好的对象`);
    assert.doesNotMatch(body, /\{\{\w/, `/${path} 里有没替换掉的占位符`);
  }
});

test("双语字段必须写明取哪边，否则构建期就报错", async () => {
  const { readContent } = await import("../lib/content/content.ts");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = await mkdtemp(join(tmpdir(), "mysite-"));
  try {
    await writeFile(join(dir, "bad.txt"), "我是{{title}}");
    await assert.rejects(
      () => readContent(dir),
      /bad\.txt[\s\S]*不是字符串[\s\S]*title\.zh/,
      "取到对象时要抛，而且要说清楚该怎么写"
    );

    await writeFile(join(dir, "bad.txt"), "我是{{title.zh}}，{{nope}} 原样留着");
    const ok = await readContent(dir);
    assert.equal(ok["bad.txt"], `我是${ME.title.zh}，{{nope}} 原样留着`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("文件名进不了 URL 的文章，构建期就报错", async () => {
  const { buildFeed } = await import("../lib/content/feed.ts");
  const { getPost } = await import("../lib/content/content.ts");

  // 以前 readPosts 只看 .md 后缀、getPost 另有白名单，于是「我的文章.md」
  // 会进列表和 RSS，点开却 404 —— 现在两边同一套约束，坏名字当场炸
  assert.equal(await getPost("我的文章"), null);
  assert.equal(await getPost("../etc/passwd"), null, "路径穿越仍然挡住");

  // RSS 的 URL 也要转义，不能只转 title
  const xml = buildFeed([
    {
      slug: "a&b",
      title: "T",
      date: "",
      updated: "",
      description: "D",
      lang: "zh",
      tags: [],
      image: "",
      draft: false,
      body: "",
    },
  ]);
  assert.match(xml, /<link>[^<]*a&amp;b<\/link>/, "link 里的 & 要转义");
  assert.doesNotMatch(xml, /<link>[^<]*a&b</, "裸 & 会让 XML 解析失败");
});

// 渲染结果直接进 dangerouslySetInnerHTML。原始 HTML 被 remark-rehype 丢掉了，
// 但链接的 URL 不检查的话 javascript: 会原样变成可点的 href
test("markdown 里的危险 URL scheme 在构建期就炸", async () => {
  const { renderMarkdown } = await import("../lib/content/markdown.ts");

  for (const md of [
    "[点我](javascript:alert(1))",
    "![x](javascript:alert(1))",
    "[d](data:text/html,hi)",
    "[vb](vbscript:msgbox(1))",
  ]) {
    await assert.rejects(() => renderMarkdown(md), /不安全的 scheme/, `没挡住: ${md}`);
  }

  // 正常链接不能被误伤
  for (const [md, want] of [
    ["[ok](https://example.com)", 'href="https://example.com"'],
    ["[m](mailto:a@b.com)", 'href="mailto:a@b.com"'],
    ["[rel](/posts/x)", 'href="/posts/x"'],
    ["[a](#s)", 'href="#s"'],
    ["![i](/x.png)", 'src="/x.png"'],
  ]) {
    assert.match(await renderMarkdown(md), new RegExp(want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  // 代码高亮走的是同一条管线，别把 shiki 一起挡掉
  assert.match(await renderMarkdown("```ts\nconst a = 1;\n```"), /class="shiki/);
});

test("NEXT_PUBLIC_SITE_URL 少写协议也认，写错了要说人话", async () => {
  const { normalizeSiteUrl } = await import("../lib/site/me.ts");

  // 第一次部署就栽在这儿：填了 heimnad.com，new URL() 抛 Invalid URL，
  // 而 Next 把它报成 "Failed to collect configuration for /_not-found"
  assert.equal(normalizeSiteUrl("heimnad.com"), "https://heimnad.com");
  assert.equal(normalizeSiteUrl("https://heimnad.com"), "https://heimnad.com");
  assert.equal(normalizeSiteUrl("  heimnad.com  "), "https://heimnad.com");

  // 尾斜杠得去掉，否则拼出 https://heimnad.com//posts/x
  assert.equal(normalizeSiteUrl("https://heimnad.com/"), "https://heimnad.com");
  assert.equal(normalizeSiteUrl("heimnad.com/"), "https://heimnad.com");

  // 本地的 http 要保住，别被强行升到 https
  assert.equal(normalizeSiteUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(normalizeSiteUrl(undefined), "http://localhost:3000");
  assert.equal(normalizeSiteUrl(""), "http://localhost:3000");

  // 真填错了要给一条看得懂的错，而不是 Invalid URL
  assert.throws(
    () => normalizeSiteUrl("https://not a domain"),
    /NEXT_PUBLIC_SITE_URL 不是合法地址[\s\S]*heimnad\.com/
  );
});

test("版本号来自构建，不是手写的 0.x", async () => {
  const { VERSION, OS_NAME, SHELL_NAME, SHELL_PATH } = await import("../lib/site/me.ts");
  // 要么是 commit hash（可带 -dirty），要么是拿不到 git 时的兜底
  assert.match(VERSION, /^([0-9a-f]{7}(-dirty)?|unknown)$/, `版本号形状不对: ${VERSION}`);
  assert.doesNotMatch(VERSION, /^\d+\.\d+/, "别退回手写版本号");

  // 旧名字不该在任何地方留下
  const files = toFileMap(await readRootfs());
  for (const [path, body] of Object.entries(files))
    assert.doesNotMatch(body, /mysite-sh/, `/${path} 里还留着旧的 shell 名`);

  assert.equal(SHELL_PATH, `/bin/${SHELL_NAME}`);
  assert.match(files["etc/os-release"], new RegExp(`NAME="${OS_NAME}"`));
  assert.match(files["etc/passwd"], new RegExp(SHELL_PATH));
  assert.match(files[`bin/ls`], new RegExp(`^#!${SHELL_PATH}`));
});

test("命令在真实 rootfs 上跑得通", async () => {
  const root = await readRootfs();
  const real = async (cmd: string, cwd: string[] = at()) => {
    const r = await execute(cmd, ctxOf(root, cwd));
    assert.equal(r.error, undefined, `意外报错: ${r.error}`);
    return r.output as string;
  };
  assert.match(await real("ls"), /projects\//);
  assert.equal(await real("ls | grep posts"), "posts/");
  assert.match(await real("cat skills.txt | grep Language | wc -l"), /3$/);
  assert.match(await real("cat why-a-terminal.md", at("posts")), /终端/);
  assert.match(await real("tree"), /└──|├──/);
});

test("Linux 骨架：content/ 挂在家目录，/etc /bin 等有内容", async () => {
  const root = await readRootfs();
  const real = async (cmd: string, cwd: string[] = at()) => {
    const r = await execute(cmd, ctxOf(root, cwd));
    assert.equal(r.error, undefined, `意外报错: ${r.error}`);
    return r.output as string;
  };
  // content/ 的内容确实在 /home/<user> 而不是根目录
  assert.match(await real("ls /"), /home\//);
  assert.doesNotMatch(await real("ls /"), /skills\.txt/, "content 不该散在根目录");
  assert.match(await real(`cat /home/${ME.user}/skills.txt`), /Language/);
  assert.match(await real("cat /etc/hostname"), new RegExp(ME.host));
  assert.match(await real("cat /etc/motd"), /help/);
  assert.match(await real(`grep ${ME.user} /etc/passwd`), new RegExp(ME.name));
  // /bin 从注册表生成，加了命令就该自己出现
  assert.match(await real("ls /bin | grep grep"), /grep/);
  assert.match(await real("cat /bin/ls"), /man ls/);
});

test("parseFrontmatter 拆出字段和正文", async () => {
  const r = parseFrontmatter('---\ntitle: 标题\ndate: 2026-07-29\ntags: "a, b"\n---\n\n正文');
  assert.deepEqual(r.meta, { title: "标题", date: "2026-07-29", tags: "a, b" });
  assert.equal(r.body, "正文", "正文前的空行要 trim 掉");
});

test("parseFrontmatter: 没有 frontmatter 时原样返回", async () => {
  assert.deepEqual(parseFrontmatter("# 只有正文"), { meta: {}, body: "# 只有正文" });
  assert.deepEqual(
    parseFrontmatter("正文里有 --- 分割线\n---\n下一段").meta,
    {},
    "--- 不在开头就不算 frontmatter"
  );
});

test("draft: 生产读不到，显式要才给，猜 URL 也进不去", async () => {
  const published = await readPosts({ drafts: false });
  const withDrafts = await readPosts({ drafts: true });

  const drafts = withDrafts.filter((p) => p.draft);
  assert.ok(drafts.length > 0, "得有一篇草稿样例，否则这条测试是空的");
  for (const d of drafts)
    assert.ok(
      !published.some((p) => p.slug === d.slug),
      `草稿 ${d.slug} 漏进了发布列表`
    );

  // 直接访问 URL 也不能绕过去
  const one = drafts[0];
  assert.equal(await getPost(one.slug), null, "草稿不该能靠猜 slug 访问到");
});

test("草稿在生产构建里从每一条路径上消失", async () => {
  const { toFileMap, toStatTree } = await import("../lib/terminal/fs.ts");

  const drafts = (await readPosts({ drafts: true })).filter((p) => p.draft);
  assert.ok(drafts.length > 0, "得有一篇草稿样例，否则这条测试是空的");

  // 曾经的洞：只在 readPosts 上过滤了，而终端文件树走 readContent，照单全收 ——
  // /api/fs/.../<草稿>.md 在线上是 200，ls posts 也看得见
  const published = toFileMap(await readRootfs({ drafts: false }));
  for (const d of drafts) {
    for (const p of Object.keys(published))
      assert.doesNotMatch(p, new RegExp(d.slug), `草稿 ${d.slug} 还在 /${p}`);
    for (const body of Object.values(published))
      assert.doesNotMatch(body, /^# 这是一篇草稿/m, `草稿正文漏进了 /api/fs`);
  }

  // 结构树（发给客户端的那份）同样不能有
  const tree = JSON.stringify(toStatTree(await readRootfs({ drafts: false })));
  for (const d of drafts) assert.doesNotMatch(tree, new RegExp(d.slug), "结构树里还有草稿");

  // 显式要的时候要给得出来，否则 dev 下没法预览
  const all = toFileMap(await readRootfs({ drafts: true }));
  assert.ok(Object.keys(all).some((p) => p.includes(drafts[0].slug)), "dev 下该看得见");
});

test("排序：日期倒序，同一天按文件名 —— 顺序必须可复现", async () => {
  const posts = await readPosts({ drafts: true });
  for (let i = 1; i < posts.length; i++) {
    const [prev, cur] = [posts[i - 1], posts[i]];
    const byDate = (cur.date || "").localeCompare(prev.date || "");
    assert.ok(byDate <= 0, `${prev.slug} 和 ${cur.slug} 的日期顺序反了`);
    if (byDate === 0)
      assert.ok(prev.slug.localeCompare(cur.slug) < 0, "同一天要按文件名，否则顺序看运气");
  }
  // 跑两次结果必须一样
  const again = await readPosts({ drafts: true });
  assert.deepEqual(again.map((p) => p.slug), posts.map((p) => p.slug));
});

test("frontmatter: tags / lang / updated / image / draft 都真的解析", async () => {
  const { PRIMARY_LANG } = await import("../lib/site/me.ts");
  const posts = await readPosts({ drafts: true });
  const tagged = posts.find((p) => p.tags.length);
  assert.ok(tagged, "得有一篇带 tags 的，否则测不到");
  assert.ok(!tagged.tags.some((t) => t.includes(",")), "tags 要拆开，不是留一整串");

  // 没写 lang 的按站点主语言算，不是 undefined
  for (const p of posts) assert.ok(["zh", "en"].includes(p.lang), `${p.slug} 的 lang 不合法`);
  assert.equal(
    posts.find((p) => p.slug === "why-a-terminal")?.lang,
    PRIMARY_LANG,
    "frontmatter 里没写 lang 就该拿站点主语言"
  );

  // 缺字段一律给空串/空数组，页面上不会冒出 undefined
  for (const p of posts) {
    assert.equal(typeof p.updated, "string");
    assert.equal(typeof p.image, "string");
    assert.equal(typeof p.draft, "boolean");
    assert.ok(Array.isArray(p.tags));
  }
});

test("readPosts: 按日期倒序，缺字段有兜底", async () => {
  const posts = await readPosts();
  assert.ok(posts.length > 0);
  const dates = posts.map((p) => p.date).filter(Boolean);
  assert.deepEqual(dates, [...dates].sort().reverse(), "应按日期倒序");
  for (const p of posts) {
    assert.ok(p.title, `${p.slug} 应该有 title`);
    assert.ok(p.description, `${p.slug} 应该有 description`);
    assert.doesNotMatch(p.description, /^#/, "description 不该是标题行");
    assert.ok(p.description.length <= 151, "description 要截断");
  }
});

test("getPost: 挡住路径穿越，slug 来自 URL 不可信", async () => {
  assert.equal(await getPost("../me"), null);
  assert.equal(await getPost("../../package.json"), null);
  assert.equal(await getPost("posts/x"), null);
  assert.equal(await getPost("不存在的文章"), null);
  assert.ok(await getPost("why-a-terminal"), "正常 slug 要能取到");
});

test("open 只认 ~/posts 下的 md", async () => {
  const root = await readRootfs();
  const err = async (cmd: string, cwd: string[] = at()) =>
    (await execute(cmd, ctxOf(root, cwd))).error;
  assert.match((await err("open skills.txt"))!, /只有 ~\/posts\/ 里的文章/);
  assert.match((await err("open posts/nope.md"))!, /没有那个文件或目录/);
  assert.match((await err("open /etc/motd"))!, /只有 ~\/posts\/ 里的文章/);
  assert.match((await err("open"))!, /用法/);
  // 换个 cwd 也要认得出来是同一篇文章
  assert.equal(await err("open ~/posts/why-a-terminal.md", ["etc"]), undefined);
});

test("renderMarkdown: 代码块真的被 shiki 高亮，GFM 表格能出来", async () => {
  const { renderMarkdown } = await import("../lib/content/markdown.ts");
  const html = await renderMarkdown(
    ["```ts", "const x: number = 1;", "```", "", "| a | b |", "| - | - |", "| 1 | 2 |"].join("\n")
  );
  assert.match(html, /class="shiki/, "代码块应该被 shiki 处理");
  assert.match(html, /style="color:#[0-9A-Fa-f]{6}/, "应该有着色 span");
  assert.match(html, /<table>/, "remark-gfm 的表格应该渲染");
});

test("renderMarkdown: 配置里声明的语言都能高亮", async () => {
  const { renderMarkdown } = await import("../lib/content/markdown.ts");
  // 少声明一种语言 shiki 会静默不高亮，这里逐个盯着
  for (const lang of ["ts", "tsx", "js", "bash", "python", "c", "json", "css", "html", "md"]) {
    const html = await renderMarkdown(`\`\`\`${lang}\nx\n\`\`\``);
    assert.match(html, /class="shiki/, `${lang} 没有被高亮，检查 markdown.ts 的 langs`);
  }
});

test("posts 命令：列标题日期，空列表有话说", async () => {
  const root = await readRootfs();
  const run = async (cmd: string, posts: PostMeta[]) => {
    const r = await execute(cmd, ctxOf(root, at(), posts));
    assert.equal(r.error, undefined, `意外报错: ${r.error}`);
    return r.output as string;
  };
  assert.match(await run("posts", []), /还没有文章/);
  const out = await run("posts", [
    { slug: "a", title: "第一篇", date: "2026-07-29", lang: "zh", tags: [] },
    { slug: "b", title: "第二篇", date: "2026-01-01", lang: "zh", tags: [] },
  ]);
  assert.match(out, /2026-07-29 {2}第一篇 {2}\(posts\/a\.md\)/);
  assert.match(out, /2026-01-01 {2}第二篇/);
});

test("escapeXml 覆盖全部五个字符 —— 生成 OG 图的脚本共用它", async () => {
  const { escapeXml } = await import("../lib/content/xml.ts");
  // 曾经有两份转义器，脚本那份漏了引号；SVG 属性里出现 " 就会冲破属性
  assert.equal(escapeXml(`&<>"'`), "&amp;&lt;&gt;&quot;&apos;");
  assert.equal(escapeXml('他说"你好"'), "他说&quot;你好&quot;");
  assert.equal(escapeXml("没有特殊字符"), "没有特殊字符");
});

test("RSS: 标题里的 & < > 不能破坏 XML", async () => {
  const { buildFeed } = await import("../lib/content/feed.ts");
  const xml = buildFeed([
    {
      slug: "x",
      title: "C & C++ <标签> 与 'quote'",
      date: "2026-07-29",
      updated: "",
      description: 'a & b <c> "d"',
      lang: "zh",
      tags: [],
      image: "",
      draft: false,
      body: "",
    },
  ]);
  assert.match(xml, /^<\?xml version="1\.0"/);
  assert.match(xml, /<atom:link[^>]*rel="self"/);
  assert.match(xml, /C &amp; C\+\+ &lt;标签&gt;/);
  // 除了实体本身，不允许出现裸的 &
  assert.doesNotMatch(
    xml.replace(/<\?xml[\s\S]*?\?>/, ""),
    /&(?!(amp|lt|gt|quot|apos);)/,
    "存在未转义的 &"
  );
  assert.match(xml, /<pubDate>Wed, 29 Jul 2026/);
});

test("RSS: 真实文章能生成合法 feed", async () => {
  const { buildFeed } = await import("../lib/content/feed.ts");
  const xml = buildFeed(await readPosts());
  assert.match(xml, /<item>/, "应该有文章条目");
  assert.equal(
    (xml.match(/<item>/g) ?? []).length,
    (await readPosts()).length,
    "条目数应与文章数一致"
  );
});

test("toStatTree: 结构保留，正文全部剥掉", async () => {
  const stat = toStatTree(await readRootfs());
  assert.ok(isDir(stat.home), "目录结构要保留");
  assert.equal(getNode(stat, at("skills.txt")), null, "文件的叶子应该是 null");
  // 整棵结构树里不该出现任何文件正文
  assert.doesNotMatch(JSON.stringify(stat), /Language|frontmatter|终端风个人主页/);
});

test("toFileMap: 每个文件一条，路径是绝对 segment 拼的", async () => {
  const map = toFileMap(await readRootfs());
  assert.match(map[`home/${ME.user}/skills.txt`], /Language/);
  assert.match(map["etc/hostname"], new RegExp(ME.host));
  assert.equal(map[`home/${ME.user}`], undefined, "目录不该出现在表里");
  // 结构树的文件数应与 map 条数一致
  const countFiles = (d: ReturnType<typeof toStatTree>): number =>
    Object.values(d).reduce((n, v) => n + (isDir(v) ? countFiles(v) : 1), 0);
  assert.equal(countFiles(toStatTree(await readRootfs())), Object.keys(map).length);
});

test("预热包含所有常用文件，但不含文章", async () => {
  const { HOME, toFileMap } = await import("../lib/terminal/fs.ts");
  const all = toFileMap(await readRootfs());
  const postsPrefix = [...HOME, "posts"].join("/") + "/";

  const warm = Object.keys(all).filter((p) => !p.startsWith(postsPrefix));
  const posts = Object.keys(all).filter((p) => p.startsWith(postsPrefix));

  assert.ok(posts.length > 0, "应该有文章被排除在外");
  assert.ok(warm.includes(`home/${ME.user}/about.txt`), "about 该被预热");
  assert.ok(warm.includes("etc/motd"), "系统文件也该被预热");
  assert.equal(warm.length + posts.length, Object.keys(all).length, "不该有文件两头都不沾");

  // 预热包不该大到失去意义 —— 它是要在后台一次拉完的
  const bytes = warm.reduce((n, p) => n + all[p].length, 0);
  assert.ok(bytes < 64 * 1024, `预热包 ${bytes} 字节，太大了该重新划线`);
});

test("cat 只为真实存在的文件发请求，且同一文件只读一次", async () => {
  const full = await readRootfs();
  const reads: string[] = [];
  const base = ctxOf(full);
  const cache = new Map<string, string>();
  const ctxCounting = {
    ...base,
    read: async (segs: string[]) => {
      const key = segs.join("/");
      if (!cache.has(key)) {
        reads.push(key); // 只记真正的未命中
        cache.set(key, await base.read(segs));
      }
      return cache.get(key)!;
    },
  };

  // 不存在的文件：结构树上就判定失败，不该发请求
  assert.match((await execute("cat nope.txt", ctxCounting)).error!, /没有那个文件或目录/);
  assert.deepEqual(reads, [], "路径不存在时不该请求");

  // 目录：同样在结构树上拦下
  assert.match((await execute("cat posts", ctxCounting)).error!, /是一个目录/);
  assert.deepEqual(reads, []);

  // 读两次同一个文件，只该有一次未命中
  await execute("cat skills.txt", ctxCounting);
  await execute("cat skills.txt | grep Language", ctxCounting);
  assert.deepEqual(reads, [`home/${ME.user}/skills.txt`], "缓存命中后不再请求");
});
