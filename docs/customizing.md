# 改造这个站

面向 fork 了这个仓库、想把它变成自己的人。想知道**为什么**这么设计，看
[architecture.md](architecture.md)。

## 不用碰代码的部分

| 想改什么 | 改哪里 |
|---|---|
| 名字 / 邮箱 / GitHub | `lib/site/me.ts` |
| 终端里的文件 | 往 `content/` 里丢文件，`ls`/`cat`/Tab 补全自动认 |
| 写文章 | `content/posts/` 里放 `.md`，自动进 `/posts` 和 RSS |
| 换头像 | 覆盖 `assets/avatar.jpg`，然后 `npm run avatar` |
| `/etc`、`/bin` 里那些玩笑 | `lib/content/rootfs.ts` |

`npm run avatar` 会一次生成字符画、圆形图标和 OG 分享图，全部在构建期出好，
运行时零转换开销。

### 占位符

内容文件里可以写 `{{name}}` `{{email}}` `{{github}}` `{{repo}}`，取的是
`lib/site/me.ts` 里的值 —— 邮箱这种东西只在一个地方维护。往 `ME` 加个字段，
对应的 `{{字段名}}` 立刻就能用。

`github` 和 `repo` 是两回事：前者回答"我是谁"（联系方式、`neofetch`、OG 图），
后者回答"这个站的源码在哪"（`motd` 的 Source、项目页、`/etc/os-release`）。

双语字段必须写明取哪边：`{{title.zh}}` 或 `{{title.en}}`。写成 `{{title}}`
会在**构建期报错**，而不是渲染出 `[object Object]`。

### 文章的 frontmatter

全部可选：

| 字段 | 作用 | 缺省 |
|---|---|---|
| `title` | 标题 | 正文第一个 `#`，再退回文件名 |
| `date` | 发表日期 `YYYY-MM-DD`，用于排序 | 空（排最后） |
| `updated` | 最后更新日期，文章页显示 `↻` | 不显示 |
| `description` | `<meta>` 和 OG 卡片的摘要 | 正文第一段，截到 150 字 |
| `tags` | 逗号分隔。终端里 `posts <标签>` 可筛 | 无 |
| `lang` | `zh` / `en`。和界面语言不同时会标出来 | `me.ts` 里的 `PRIMARY_LANG` |
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

**草稿在 `npm run dev` 下可见，生产构建里完全不存在** —— 不只是列表、RSS 和
sitemap 里没有，终端的 `ls` 看不见、`cat` 读不到，`/api/fs` 也不会为它生成端点。

文件名只能用字母、数字、`_` 和 `-`（要进 URL）。用了中文之类的字符会在构建期
报错，而不是进了列表却打不开。

解析器**只认单行 `key: value`**，不认 YAML 数组和嵌套。`tags` 用逗号分隔
（写成 `[a, b]` 也认）。真需要完整 YAML 的时候再引入 gray-matter。

---

## 加一条命令

往 `lib/terminal/commands.ts` 的 `COMMANDS` 表里加一项：

```ts
uptime: {
  desc: { zh: "显示运行时间", en: "show uptime" },
  run: () => `${Math.floor(performance.now() / 1000)}s`,
},
```

**这五样自动就有了**，不用改任何别的地方：

- `help` 里的条目
- `man uptime`
- Tab 补全
- `/bin/uptime` 这个文件（`ls /bin` 看得到，`cat` 得出内容）
- 管道 —— 返回字符串就能接 `| grep` `| wc`

`desc` 是双语对，类型强制两种语言都写，漏一个编译不过。想写更长的手册页就加
`man` 字段，想写用法行就加 `usage`；不写 `man` 时 `man` 命令会退回用 `desc`。

加 `hidden: true` 就不出现在 `help` 和 Tab 补全里 —— 彩蛋用这个。

### 要参数、要读文件、要报错

```ts
grep: {
  desc: { zh: "按模式筛选行", en: "print lines matching a pattern" },
  usage: { zh: "grep [-i] <模式> [文件...]", en: "grep [-i] <pattern> [file...]" },
  async run(args, stdin, ctx) {
    if (!args[0]) throw new Error(ctx.t("用法: grep <模式>", "usage: grep <pattern>"));
    const text = await readInput(args.slice(1), stdin, ctx, "grep");
    return text.split("\n").filter((l) => l.includes(args[0])).join("\n");
  },
},
```

- **`throw` 就是报错**，消息会以红色出现在终端里。用 `ctx.t(中文, English)` 就地写双语。
- **`readInput(args, stdin, ctx, 名字)`** 处理"有文件名就读文件、没有就读标准输入"，
  和真 coreutils 一样；文件不存在、是目录之类的错误它都替你报好了。
- 要读文件就写 `async` —— 只看目录结构的命令（`ls`/`cd`/`tree`）保持同步。

### 别名

往同文件的 `ALIASES` 加一行：

```ts
ll: "ls -l",
```

`help`、`alias` 命令、Tab 补全和 `~/.bashrc` 的内容都会自动带上它。别名在查命令
之前展开，只作用于第一个词 —— 和真 shell 一样。

### 图形输出的命令

命令层只返回文本，所以要画字符画的命令返回一个标记，由 UI 层认领。四步：

1. `lib/terminal/commands.ts` 的 `Visual` 联合类型加一个变体
2. 同文件加命令表项，`run` 返回 `{ render: "matrix" }`
3. `components/terminal-visuals.tsx` 写组件
4. 同文件的 `renderVisual` 里加一个 `case`

**漏掉第 4 步会编译不过** —— `renderVisual` 的 `default` 分支有一行
`const missing: never = v`，认领不全时 `tsc` 直接报错。以前这里是一串 `else if`，
漏一个不会有任何提示，命令能跑但屏幕上什么都不出现。

### 加一个可以 apt install 的包

有些命令要带一大坨数据（figlet 的字体 30 kB，比整个命令层还大）。这种东西不该
进首屏，于是它们变成"包"：装了才存在。

1. 把数据文件放进 `public/apt/pool/universe/<首字母>/<包名>/`
2. 在 `lib/terminal/packages.ts` 的 `PACKAGES` 里登记 `path` `version` `desc`
3. 给命令加 `pkg: "包名"`

然后：没装的时候 `help`、Tab 补全和命令查找里都没有它，敲了会得到 Ubuntu 那句
`Command 'x' not found, but can be installed with: sudo apt install x`；装了就全都有。
`/apt/` 那个镜像目录页也会自己长出新路径。

**这里的下载是真的。** `apt` 输出里 `Get:1` 那行的地址浏览器能打开，字节数和速率
是那次 fetch 真实测出来的 —— 所以别在这条路径上加假的进度条或假的延迟。

### 往站外发请求

默认情况下这个站不联系任何第三方 —— 统计脚本不种 cookie，其余全是自己的接口。
**`wttr` 是唯一的例外**：它去 wttr.in 取天气，所以访客的 IP 会被那台服务器看到。
`man wttr` 里写明了这一点，删掉这条命令的话记得连那句说明一起删。

要加类似的命令，两件事别省：

1. **在 `man` 里说清楚它联系谁**。访客有权知道哪条命令会把自己暴露出去。
2. **别把它放进 CI 的 e2e**。外部服务宕机让 CI 变红，只会教人忽略红灯 ——
   `e2e/terminal.spec.ts` 里那组联网用例用 `test.skip(!!process.env.CI, …)` 跳过，
   解析逻辑则用真实响应删减出来的夹具在单测里覆盖。

顺带：浏览器只允许读那些发了 `Access-Control-Allow-Origin` 的站点，所以能不能
接一个接口不取决于你，取决于对方。`curl` 现在会真的去请求，失败时报的是
"没能连上"而不是假装 DNS 挂了。

### 需要新的副作用

命令层是纯逻辑，不碰 `window`、`document`、`fetch` —— 这条边界由 eslint 强制。
要开新标签、写剪贴板这类事，得走 `Ctx` 回调，改三处：

| 文件 | 改什么 |
|---|---|
| `lib/terminal/commands.ts` | `Ctx` 类型加字段 |
| `components/terminal.tsx` | `makeCtx` 里给真实实现 |
| `tests/fixtures.mts` | `ctxOf` 里给测试替身 |

三处都是编译期强制的，漏一个 `tsc` 会报错。**这是特性**：它逼你同时想清楚真实
实现和测试里该怎么替换，而不是让测试悄悄地什么都不做。

## 测试

```bash
npm test                                   # 类型检查 + 单元测试
npx playwright install chromium webkit     # 第一次跑 e2e 之前
npm run e2e                                # Playwright，跑生产构建
```

要 webkit 是因为有一条用例专门跑它：`deviceMemory` 和 `performance.memory`
只有 Chromium 系的浏览器报，而"拿不到就写 null"这条**只有在真正拿不到的引擎上
才验得了**。在 Chromium 上跑那条用例等于没测。

命令层是纯逻辑，所以整层都能用 `node --test` 跑，不碰网络也不碰 DOM。加了命令
就在 `tests/shell.test.mts` 加个断言：

```ts
assert.equal(await out("uptime"), "0s");
```

`out()` 和 `err()` 是 `tests/fixtures.mts` 里的夹具，跑一条命令并返回输出／错误。

**牵涉 UI 的东西写进 `e2e/terminal.spec.ts`** —— 滚动、输入法、焦点、动画这些
单测一个都覆盖不到，而这个项目遇到的 UI bug 全在那一层。
