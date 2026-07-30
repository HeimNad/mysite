# mysite

就是你现在看到的这个网站。

Next.js + 纯手写的终端模拟器。没用 xterm.js，没用任何终端库 ——
管道、cwd、Tab 补全、man page 全部是自己实现的。

技术上有意思的几点：

- 头像字符画在**构建期**生成（sharp 缩到 40 列，逐像素映射到 @%#*+=-:. 灰阶），
  运行时零转换开销，颜色靠 span 内联
- 命令层是纯 TypeScript，不含 JSX、不碰 DOM —— 所以 `node --test` 能原生跑它
- 文件正文按需加载：客户端只拿目录结构，`cat` 时才去取内容
- `ls` 会检查自己的输出是不是接了管道，直连时排一行、被管道时一行一个

---

# mysite (English)

The site you are looking at right now.

Next.js plus a hand-written terminal emulator — no xterm.js, no terminal
library. Pipes, the working directory, Tab completion and man pages are all
implemented from scratch.

The parts I find interesting:

- The ASCII avatar is generated **at build time** (sharp downscales to 40
  columns, then each pixel maps onto the `@%#*+=-:. ` ramp), so there is zero
  conversion cost at runtime; colour comes from inline spans
- The command layer is plain TypeScript with no JSX and no DOM access, which
  is why `node --test` can run all of it natively
- File contents load on demand: the client only receives the directory
  structure, and `cat` fetches the body when you ask for it
- `ls` checks whether its output is a pipe — one entry per line when it is,
  columns when it is not, same as the real thing

源码 / Source: {{github}}
