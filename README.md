# mysite

一个终端风格的个人网站。不是"看起来像终端的贴图"—— 管道、`cd`、Tab 补全、
`man` page 都按 POSIX 的直觉真正工作。

**线上： [heimnad.com](https://heimnad.com)**

```
heimnad@web:~$ cat skills.txt | grep Language | wc -l
     3
```

同一份 `content/` 目录有两种呈现：终端里 `cat` 出来是 markdown 源码，
浏览器里 `/posts/<slug>` 是排版好的文章页（代码高亮、OG 卡片、RSS）。

*[English](#english) below — 简介和上手指南。深入的文档只有中文。*

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:3000。`npm run dev` 会一直占着终端，其余命令另开一个窗口跑。

手机上用局域网 IP 调试时，`next.config.ts` 里的 `allowedDevOrigins`
已经放开了私有网段 —— 不放开的话 dev server 会拦掉所有 `/_next/*` 请求，
页面只剩个不能输入的提示符。

## 自定义

**改内容不用碰代码。**

| 想改什么 | 改哪里 |
|---|---|
| 名字 / 邮箱 / GitHub | `lib/site/me.ts` |
| 终端里的文件 | 往 `content/` 里丢文件，`ls`/`cat`/Tab 补全自动认 |
| 写文章 | `content/posts/*.md`，自动出现在 `/posts` 和 RSS 里 |
| 换头像 | 覆盖 `assets/avatar.jpg`，然后 `npm run avatar` |
| `/etc`、`/bin` 里那些玩笑 | `lib/content/rootfs.ts` |

内容文件里可以写 `{{name}}` `{{email}}` `{{github}}` 引用 `lib/site/me.ts` 的值，
所以邮箱这种东西只需要在一个地方维护。双语字段要写明取哪边：`{{title.zh}}`。

### 文章的 frontmatter

全部可选：

| 字段 | 作用 | 缺省 |
|---|---|---|
| `title` | 标题 | 正文第一个 `#`，再退回文件名 |
| `date` | 发表日期 `YYYY-MM-DD`，用于排序 | 空（排最后） |
| `updated` | 最后更新日期，文章页显示 `↻` | 不显示 |
| `description` | `<meta>` 和 OG 卡片的摘要 | 正文第一段，截到 150 字 |
| `tags` | 逗号分隔。终端里 `posts <标签>` 可筛 | 无 |
| `lang` | `zh` / `en`。和界面语言不同时会标出来 | `lib/site/me.ts` 的 `PRIMARY_LANG` |
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

解析器**只认单行 `key: value`**，不认 YAML 数组和嵌套。`tags` 用逗号分隔
（写成 `[a, b]` 也认）。真需要完整 YAML 的时候再引入 gray-matter。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器，前台常驻 |
| `npm test` | 类型检查 + 单元测试（`node --test` 原生跑 TS，没有测试框架） |
| `npm run e2e` | Playwright，跑生产构建 |
| `npm run build` | 生产构建 |
| `npx eslint .` | lint，含跨运行时边界检查 |
| `npm run avatar` | 从 `assets/avatar.jpg` 生成字符画、图标、OG 图 |

## 项目地图

```
app/              只有 Next：路由、layout、页面装配、Route Handler
components/       客户端 UI：终端本体 + 视觉组件
lib/
  terminal/       纯逻辑，浏览器和 Node 里都能跑
  content/        只在服务端／构建期
  site/           两边共用的配置（me.ts 就是这个）
tests/            单元测试
e2e/              Playwright
content/          你的 markdown 和资料文本，独立于代码
```

`lib/terminal` 和 `lib/site` 是**跨运行时的纯逻辑**，`lib/content` 只在服务端用。
前两者不许依赖 React、Next、`node:*` 或浏览器全局，**这条边界由 eslint 强制**。

两个由此而来的设计：**命令返回文本而不是自己打印**（所以管道能成立），
**副作用全部通过 `Ctx` 回调注入**（所以 `node --test` 能跑整个命令层）。

其余决策和它们的代价：**[docs/architecture.md](docs/architecture.md)**

## 部署

静态导出即可，任何静态托管都能跑。上线后记得设环境变量，否则 sitemap / RSS / OG
里的链接会指向 localhost：

```
NEXT_PUBLIC_SITE_URL=https://你的域名
```

## 许可

代码随便用。`content/` 里的文字和 `assets/` 里的头像是我的，别拿去用。

---

## English

A terminal-styled personal site — and not a picture of a terminal. Pipes work,
`cd` works, Tab completes paths, and every command has a real man page.

**Live at [heimnad.com](https://heimnad.com)**

```
heimnad@web:~$ cat skills.txt | grep Language | wc -l
     3
```

The same `content/` directory has two faces: in the terminal `cat` shows you the
markdown source, while `/posts/<slug>` serves a typeset page with syntax
highlighting, an OG card and an RSS entry.

The interface is bilingual and follows your browser on the first visit; `lang en`
and `lang zh` switch it, and the choice is remembered. Articles are in Chinese
only for now, and translation is opt-in per file.

### Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000. `npm run dev` holds the terminal, so run
anything else in a second window: `npm test`, `npm run e2e`, `npm run build`,
`npm run avatar`.

### Making it yours

`lib/site/me.ts` holds the name, email and GitHub URL. Drop files into
`content/` and `ls`/`cat`/Tab completion pick them up; `content/posts/*.md`
become articles automatically. Content files may use `{{name}}`, `{{email}}`
and `{{github}}` placeholders — bilingual fields need a language, as in
`{{title.en}}`.

Article frontmatter is all optional: `title`, `date`, `updated`, `description`,
`tags`, `lang`, `image`, `draft`. Drafts are visible under `npm run dev` and
absent from a production build — no listing, RSS or sitemap entry, and guessing
the URL gets a 404.

Set `NEXT_PUBLIC_SITE_URL` when you deploy, or the sitemap, RSS and OG links
will point at localhost.

### Layout

`app/` is Next and nothing else. `components/` holds the client UI.
`lib/terminal` and `lib/site` are cross-runtime pure logic — no React, no Next,
no `node:`, no browser globals, and eslint enforces that. `lib/content` runs
only at build time.

The design notes live in [docs/architecture.md](docs/architecture.md), in
Chinese. Keeping one language complete rather than two half-synchronised is
deliberate: this file drifted once already.

The code is free to reuse. The prose in `content/` and the avatar in `assets/`
are mine — please don't.
