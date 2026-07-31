---
title: 为什么我的网站是个终端
date: 2026-07-29
tags: 终端, Next.js
---

# 为什么我的网站是个终端

终端风个人主页满地都是，绝大多数是八个硬编码命令的贴图：
输入 `about` 弹一段话，输入别的就报 "command not found"。
玩三十秒就穿了。

所以我给自己定了一条规矩：**访客随手试的东西，应该真的能用。**

于是有了管道。`cat skills.txt | grep Language | wc -l` 会老老实实地
数出三行，因为每个命令真的把文本传给了下一个。于是有了 `cd`，
提示符会跟着变。于是有了 `man`，每一页都是从命令自己的元数据生成的，
不可能和实现脱节。

管道听起来最玄，其实是最简单的一个 —— 只要让每个命令**返回**文本
而不是自己往屏幕上打，串起来就是一个 for 循环：

```ts
for (let i = 0; i < stages.length; i++) {
  const [name, ...args] = stages[i].split(/\s+/).filter(Boolean);
  const isLast = i === stages.length - 1;
  output = COMMANDS[name].run(args, stdin, { ...ctx, piped: !isLast });
  if (!isLast) stdin = output; // 上一条的 stdout 就是下一条的 stdin
}
```

这些加起来并没有多少代码，但它把"贴图"变成了"能玩的东西"。
深度比广度重要 —— 二十个假命令不如五个真命令。

顺便说，你现在读的这个文件是磁盘上真实的 markdown。
`ls posts` 列出的是目录里真实的文件名。
我往 content/ 里丢一个 .md，网站就多一篇文章，不用改任何代码。
