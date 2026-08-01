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

界面中英双语，首次访问跟浏览器走，`lang en` / `lang zh` 切换并记住。

*[English](#english) below.*

## 快速开始

```bash
npm install
npm run dev
```

打开 http://localhost:3000。`npm run dev` 会一直占着终端，其余命令另开一个窗口跑。

手机上用局域网 IP 调试时，`next.config.ts` 里的 `allowedDevOrigins`
已经放开了私有网段 —— 不放开的话 dev server 会拦掉所有 `/_next/*` 请求，
页面只剩个不能输入的提示符。

## 文档

| | |
|---|---|
| **[docs/customizing.md](docs/customizing.md)** | 改成你自己的：内容、文章、加命令、加彩蛋 |
| **[docs/architecture.md](docs/architecture.md)** | 为什么这么写，以及每个决定的代价 |

最短路径：改 `lib/site/me.ts` 里的名字邮箱，把 `content/` 里的文字换成你的，
`npm run avatar` 换头像。加一条命令是往 `lib/terminal/commands.ts` 加四行，
`help`、`man`、Tab 补全、`/bin` 和管道会自动带上它。

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

Edit `lib/site/me.ts` for your name and email, replace the prose in `content/`,
and run `npm run avatar` after swapping `assets/avatar.jpg`. Adding a command is
four lines in `lib/terminal/commands.ts` — `help`, `man`, Tab completion, `/bin`
and pipes all pick it up on their own.

`lib/terminal` and `lib/site` are cross-runtime pure logic — no React, no Next,
no `node:`, no browser globals, and eslint enforces that. `lib/content` runs only
at build time.

The guides are in Chinese: [customizing](docs/customizing.md) covers making it
yours, [architecture](docs/architecture.md) covers why it is built this way.
Keeping one language complete rather than two half-synchronised is deliberate:
this file drifted once already.

Set `NEXT_PUBLIC_SITE_URL` when you deploy, or the sitemap, RSS and OG links will
point at localhost.

The code is free to reuse. The prose in `content/` and the avatar in `assets/`
are mine — please don't.
