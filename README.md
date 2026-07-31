# mysite

*[English](#english) below.*

一个终端风格的个人网站。不是"看起来像终端的贴图"—— 管道、`cd`、Tab 补全、
`man` page 都按 POSIX 的直觉真正工作。

同一份 `content/` 目录有两种呈现：终端里 `cat` 出来是 markdown 源码，
浏览器里 `/posts/<slug>` 是排版好的文章页（代码高亮、OG 卡片、RSS）。

```
heimnad@web:~$ cat skills.txt | grep Language | wc -l
     3
```

## 快速开始

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # node --test 原生跑 TS，没有测试框架
npm run build
```

手机上用局域网 IP 调试时，`next.config.ts` 里的 `allowedDevOrigins`
已经放开了私有网段 —— 不放开的话 dev server 会拦掉所有 `/_next/*` 请求，
页面只剩个不能输入的提示符。

## 改内容

**不用碰代码。**

| 想改什么 | 改哪里 |
|---|---|
| 名字 / 邮箱 / GitHub | `lib/me.ts` |
| 终端里的文件 | 往 `content/` 里丢文件，`ls`/`cat`/Tab 补全自动认 |
| 写文章 | `content/posts/*.md`，自动出现在 `/posts` 和 RSS 里 |
| 换头像 | 覆盖 `assets/avatar.jpg`，然后 `npm run avatar` |
| `/etc`、`/bin` 里那些玩笑 | `lib/rootfs.ts` |

内容文件里可以写 `{{name}}` `{{email}}` `{{github}}` 引用 `lib/me.ts` 的值，
所以邮箱这种东西只需要在一个地方维护。双语字段要写明取哪边：`{{title.zh}}`。

文章的 frontmatter 支持这些字段，**全部可选**：

| 字段 | 作用 | 缺省 |
|---|---|---|
| `title` | 标题 | 正文第一个 `#`，再退回文件名 |
| `date` | 发表日期 `YYYY-MM-DD`，用于排序 | 空（排最后） |
| `updated` | 最后更新日期，文章页显示 `↻` | 不显示 |
| `description` | `<meta>` 和 OG 卡片的摘要 | 正文第一段，截到 150 字 |
| `tags` | 逗号分隔。终端里 `posts <标签>` 可筛 | 无 |
| `lang` | `zh` / `en`。和界面语言不同时会标出来 | `lib/me.ts` 的 `PRIMARY_LANG` |
| `image` | 这篇单独的 OG 图 | 站点那张 |
| `draft` | `true` 则不发布 | `false` |

```yaml
---
title: 为什么我的网站是个终端
date: 2026-07-29
tags: 终端, Next.js
draft: true
---
```

草稿在 `npm run dev` 下能看见方便预览，生产构建里读不到 —— 列表、RSS、sitemap
里都没有，直接猜 URL 也进不去。

frontmatter 解析器是故意写笨的，**只认单行 `key: value`**，不认 YAML 数组和嵌套。
`tags` 用逗号分隔（写成 `[a, b]` 也认）。真需要完整 YAML 的时候再引入 gray-matter。

`npm run avatar` 从 `assets/avatar.jpg` 一次生成四样：`neofetch` 的彩色字符画、
圆形 favicon、iOS 图标、OG 分享图。

## 架构

```
lib/fs.ts         路径解析（. .. ~ /）+ 目录树类型。纯函数
lib/commands.ts   命令注册表。纯逻辑，不碰 window/document
lib/shell.ts      管道执行器
lib/content.ts    读 content/ 目录（服务端）
lib/rootfs.ts     /etc /bin /var 等骨架，content/ 挂在 /home/<user>
app/terminal.tsx  唯一的客户端组件：输入、历史、补全、渲染
```

几个刻意的决定：

**命令层不含 JSX，也不碰 DOM。** 副作用（切目录、清屏、开新标签、换主题、
读文件）全部通过 `Ctx` 回调注入。代价是多一层间接，好处是 `node --test`
能直接跑整个命令层 —— 管道、路径解析、`grep` 的正则降级都有测试兜着。

**命令返回文本，不自己打印。** 这是管道能成立的前提：上一条的返回值
就是下一条的 `stdin`。需要图形输出的命令（`neofetch`）返回一个标记对象，
由 UI 层认领渲染。

**文件正文按需加载。** 客户端只拿目录结构（叶子是 `null`），`cat` 时才从
`/api/fs/<path>` 取内容并缓存。那些端点在构建期就静态生成好了，运行时没有
服务端代码在跑，所以路径穿越无从下手 —— 不存在的路径自然 404。

**`ls` 会检查自己的输出是不是接了管道**，直连时排一行、被管道时一行一个，
和真 `ls` 一样。

**字符画在构建期生成。** `sharp` 缩到 40 列，逐像素映射到 `@%#*+=-:. ` 灰阶，
运行时零转换开销。

**OG 图用 sharp 而不是 `next/og`。** ImageResponse 底层的 Satori 不自带
中日韩字体，中文会渲染成方块；sharp 渲染 SVG 走系统字体，构建期出图。

## 部署

上线后记得设环境变量，否则 sitemap / RSS / OG 里的链接会指向 localhost：

```
NEXT_PUBLIC_SITE_URL=https://你的域名
```

## 许可

代码随便用。`content/` 里的文字和 `assets/` 里的头像是我的，别拿去用。

---

## English

A terminal-styled personal site — and not a picture of a terminal. Pipes work,
`cd` works, Tab completes paths, and every command has a real man page.

```
heimnad@web:~$ cat skills.txt | grep Language | wc -l
     3
```

The same `content/` directory has two faces: in the terminal `cat` shows you the
markdown source, while `/posts/<slug>` serves a typeset page with syntax
highlighting, an OG card and an RSS entry.

The interface is bilingual. It follows your browser language on the first visit;
`lang en` and `lang zh` switch it, and the choice is remembered. Articles are in
Chinese only for now — translation is opt-in per file (`about.en.txt` wins over
`about.txt` when the locale is English, and files with no translation simply fall
back).

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # node --test runs the TypeScript directly, no test framework
npm run build
npm run avatar     # regenerate ASCII art, icons and the OG image from assets/avatar.jpg
```

**Changing content requires no code.** `lib/me.ts` holds the name, email and
GitHub URL; drop files into `content/` and `ls`/`cat`/Tab completion pick them up;
`content/posts/*.md` become articles automatically. Content files may use
`{{name}}`, `{{email}}` and `{{github}}` placeholders; bilingual fields need a
language, as in `{{title.en}}`.

Article frontmatter, all fields optional:

| Field | Effect | Default |
|---|---|---|
| `title` | Title | First `#` in the body, else the filename |
| `date` | `YYYY-MM-DD`, used for ordering | Empty, sorts last |
| `updated` | Last-modified date, shown with `↻` | Not shown |
| `description` | `<meta>` and OG summary | First paragraph, cut at 150 chars |
| `tags` | Comma separated; `posts <tag>` filters by them | None |
| `lang` | `zh` / `en`, flagged when it differs from the UI | `PRIMARY_LANG` in `lib/me.ts` |
| `image` | Per-article OG image | The site's |
| `draft` | `true` withholds it | `false` |

Drafts are visible under `npm run dev` for previewing and absent from a
production build — no listing, RSS or sitemap entry, and guessing the URL
gets a 404.

The frontmatter parser is deliberately small: single-line `key: value` only,
no YAML arrays or nesting. Reach for gray-matter when that stops being enough.

A few decisions worth knowing about:

- **The command layer has no JSX and never touches the DOM.** Every side effect —
  changing directory, clearing the screen, opening a tab, switching theme or
  locale, reading a file — arrives through a `Ctx` callback. The cost is one layer
  of indirection; the payoff is that `node --test` runs the whole command layer,
  including pipes, path resolution and the regex fallback in `grep`.
- **Commands return text instead of printing it.** That is what makes pipes
  possible: one stage's return value is the next stage's stdin.
- **File bodies load on demand.** The client receives only the directory structure;
  `cat` fetches from `/api/fs/<path>` and caches. Those endpoints are generated at
  build time, so no server code runs at request time and path traversal has nothing
  to attack — unknown paths simply 404.
- **Translations live inline as `{ zh, en }` pairs**, not behind lookup keys. At
  this size, `t("cat.isDirectory")` would only make the code harder to read and
  would accumulate orphaned keys nobody dares delete.

Set `NEXT_PUBLIC_SITE_URL` when you deploy, or the sitemap, RSS and OG links will
point at localhost.

The code is free to reuse. The prose in `content/` and the avatar in `assets/` are
mine — please don't.
