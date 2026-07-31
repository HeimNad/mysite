// 终端内核：路径解析、管道、ls/grep/文本命令、别名。node --test 原生跑 TS
import { test } from "node:test";
import assert from "node:assert/strict";
import { absPath, getNode, promptPath, resolvePath, toStatMap, type FSDir } from "../lib/terminal/fs.ts";
import { execute } from "../lib/terminal/shell.ts";
import { ME } from "../lib/site/me.ts";
import { at, ctxOf, errorOf, ROOT, runner } from "./fixtures.mts";

const ctx = (cwd: string[] = at()) => ctxOf(ROOT, cwd);
const out = runner(ROOT);
const err = errorOf(ROOT);

test("resolvePath: 相对、绝对、~、. 与 ..", async () => {
  assert.deepEqual(resolvePath(at(), "dir"), at("dir"));
  assert.deepEqual(resolvePath(at("dir"), ".."), at());
  assert.deepEqual(resolvePath(at("dir"), "../a.txt"), at("a.txt"));
  assert.deepEqual(resolvePath(at("dir"), "sub/../b.txt"), at("dir", "b.txt"));
  assert.deepEqual(resolvePath(at("dir"), "./sub"), at("dir", "sub"));
  assert.deepEqual(resolvePath(at("dir"), "/etc"), ["etc"], "绝对路径从根算起");
  assert.deepEqual(resolvePath(["etc"], "~"), at(), "~ 是家目录，不是根目录");
  assert.deepEqual(resolvePath(["etc"], "~/a.txt"), at("a.txt"));
  assert.deepEqual(resolvePath(at("dir"), undefined), at("dir"), "无参数 = 当前目录");
});

test("resolvePath: .. 在根目录不会越界", async () => {
  assert.deepEqual(resolvePath([], ".."), []);
  assert.deepEqual(resolvePath([], "../../.."), []);
  assert.deepEqual(resolvePath(at(), "../../../../.."), []);
});

test("getNode / absPath / promptPath", async () => {
  assert.equal(getNode(ROOT, at("dir", "sub", "c.txt")), "deep");
  assert.equal(getNode(ROOT, at("dir", "nope")), undefined);
  assert.equal(getNode(ROOT, at("a.txt", "x")), undefined, "不能穿透文件");

  assert.equal(absPath([]), "/");
  assert.equal(absPath(at()), `/home/${ME.user}`);
  assert.equal(absPath(["etc"]), "/etc");

  assert.equal(promptPath(at()), "~", "家目录缩写成 ~");
  assert.equal(promptPath(at("dir")), "~/dir");
  assert.equal(promptPath([]), "/", "根目录显示绝对路径");
  assert.equal(promptPath(["etc"]), "/etc");
  assert.equal(promptPath(["home"]), "/home", "家目录的父目录不缩写");
});

test("cd / 和 pwd 说的是同一件事", async () => {
  // 之前的 bug：pwd 说 /home/heimnad，但 cd / 到的还是同一个地方
  let landed: string[] | null = null;
  const r = await execute("cd /", { ...ctx(), setCwd: (s) => (landed = s) });
  assert.equal(r.error, undefined);
  assert.deepEqual(landed, [], "cd / 要真的到根目录");
  assert.equal(await out("pwd", []), "/");
  assert.equal(await out("pwd", at()), `/home/${ME.user}`);
  assert.equal(await out("ls", []), "etc/  home/", "根目录列的是根目录的内容");
});

test("管道把 stdout 接到下一条的 stdin", async () => {
  assert.equal(await out("cat a.txt | grep beta"), "beta");
  assert.equal(await out("cat a.txt | wc -l"), "     3");
  assert.equal(await out("cat a.txt | head -n 2 | tail -n 1"), "beta");
});

test("head/tail 的 -n 参数值不会被当成文件名", async () => {
  assert.equal(await out("head -n 2 a.txt"), "alpha\nbeta");
  assert.equal(await out("head -1 a.txt"), "alpha");
  assert.equal(await out("tail -n 1 a.txt"), "Gamma");
  assert.equal(await out("tail -n 0 a.txt"), "", "slice(-0) 不能返回全部");
  assert.equal(await out("head a.txt"), "alpha\nbeta\nGamma", "默认 10 行");
});

test("grep -i 忽略大小写，默认区分", async () => {
  assert.equal(await out("grep gamma a.txt"), "");
  assert.equal(await out("grep -i gamma a.txt"), "Gamma");
});

test("grep 非法正则退化为文本匹配而不是崩溃", async () => {
  assert.equal(await out('echo "a(b" | grep a(b'), '"a(b"');
});

test("ls 被管道时一行一个，直连时排一行", async () => {
  assert.equal(await out("ls"), "a.txt  dir/");
  assert.equal(await out("ls | wc -l"), "     2");
  assert.equal(await out("ls -a | wc -l"), "     3", "-a 才算隐藏文件");
});

test("命令相对 cwd 工作", async () => {
  assert.equal(await out("cat b.txt", at("dir")), "one\ntwo");
  assert.equal(await out("pwd", at("dir", "sub")), `/home/${ME.user}/dir/sub`);
  assert.equal(await out("cat ../a.txt | grep alpha", at("dir")), "alpha");
  assert.equal(await out("cat ~/a.txt | grep alpha", ["etc"]), "alpha", "~ 从任何地方都指家目录");
  assert.equal(await out("cat /etc/hostname", at("dir")), "web", "绝对路径从任何地方都能读");
});

test("错误：不存在的命令/文件、cd 到文件、管道接非文本输出", async () => {
  assert.match((await err("nope"))!, /未找到命令/);
  assert.match((await err("cat missing.txt"))!, /没有那个文件或目录/);
  assert.match((await err("cat dir"))!, /是一个目录/);
  assert.match((await err("cd a.txt"))!, /不是目录/);
  assert.match((await err("neofetch | wc -l"))!, /不能接管道/);
  assert.match((await err("cat a.txt |"))!, /缺少命令/);
  assert.match((await err("wc"))!, /缺少文件名/, "没有 stdin 也没有文件时要报错");
});

test("cd 通过 ctx 汇报新目录，且不产生输出", async () => {
  const landing = async (cmd: string, cwd = at()) => {
    let landed: string[] | null = null;
    const r = await execute(cmd, { ...ctx(cwd), setCwd: (s) => (landed = s) });
    assert.equal(r.error, undefined, `意外报错: ${r.error}`);
    assert.equal(r.output, undefined, "cd 不该有输出");
    return landed;
  };
  assert.deepEqual(await landing("cd dir/sub"), at("dir", "sub"));
  assert.deepEqual(await landing("cd", ["etc"]), at(), "不带参数回家目录");
  assert.deepEqual(await landing("cd /etc", at()), ["etc"]);
  assert.deepEqual(await landing("cd ~", ["etc"]), at());
});

test("padCols 按显示列数对齐，中文算两列", async () => {
  const { displayWidth, padCols } = await import("../lib/terminal/text.ts");
  assert.equal(displayWidth("hello"), 5);
  assert.equal(displayWidth("终端"), 4, "两个汉字占四列");
  assert.equal(displayWidth("终端 x"), 6, "中英混排");
  // 补齐后显示宽度必须相等 —— padEnd 做不到这件事
  for (const s of ["hello", "终端", "为什么我的网站是个终端"]) {
    assert.equal(displayWidth(padCols(s, 24)), 24, `${s} 没补到 24 列`);
  }
  assert.notEqual("终端".padEnd(10).length, displayWidth("终端".padEnd(10)), "这正是不能用 padEnd 的原因");
});

test("displayWidth 的范围边界 —— 字面量写法曾经把范围写飞", async () => {
  const { displayWidth } = await import("../lib/terminal/text.ts");
  // 原来写的是 `豈-﫿`，但打出的"豈"是 U+8C48 而不是 U+F900，
  // 范围从汉字区中间横跨到 U+FAFF，把这些全算成了双宽
  assert.equal(displayWidth("\uA78B"), 1, "拉丁扩展 D 是窄的");
  assert.equal(displayWidth("\uE000"), 1, "私用区不该当双宽");
  assert.equal(displayWidth("\uABCD"), 1, "Meetei Mayek 是窄的");
  // 这两个原来反而漏掉了
  assert.equal(displayWidth("\uF900"), 2, "CJK 兼容表意文字是宽的");
  assert.equal(displayWidth("\u{20000}"), 2, "CJK 扩展 B 是宽的");
  // 常用的照旧
  assert.equal(displayWidth("中文"), 4);
  assert.equal(displayWidth("\uAC00"), 2, "韩文音节");
  assert.equal(displayWidth("abc"), 3);
});

test("posts 的中文标题按显示列数对齐，路径列不参差", async () => {
  const r = await execute(
    "posts",
    ctxOf(ROOT, at(), [
      { slug: "a", title: "为什么我的网站是个终端", date: "2026-07-29", lang: "zh", tags: [] },
      { slug: "b", title: "短", date: "2026-01-01", lang: "zh", tags: [] },
    ])
  );
  const { displayWidth } = await import("../lib/terminal/text.ts");
  const rows = (r.output as string).split("\n").filter((l) => l.includes("(posts/"));
  assert.equal(rows.length, 2);
  const cols = rows.map((l) => displayWidth(l.slice(0, l.indexOf("(posts/"))));
  assert.equal(cols[0], cols[1], `路径列没对齐:\n${rows.join("\n")}`);
});

test("别名在查命令之前展开，并和用户给的参数拼起来", async () => {
  // ll = ls -l，所以输出必须是长格式而不是和 ls 一样
  const ll = (await out("ll")) as string;
  assert.match(ll, /^total \d+/m);
  assert.match(ll, /-r--r--r--.+a\.txt$/m);
  assert.notEqual(ll, await out("ls"), "ll 不该和 ls 表现一致");

  // la = ls -la，隐藏文件也要出现
  assert.match((await out("la")) as string, /\.hidden/);
  assert.doesNotMatch(ll, /\.hidden/, "ll 不带 -a");

  // 别名后面还能接自己的参数和管道
  assert.match((await out("ll dir")) as string, /b\.txt/);
  assert.equal(await out("l | wc -l"), "     2", "别名也能进管道");
  assert.equal(await out("."), `/home/${ME.user}`, ". 别名等于 pwd");
});

test("alias 命令列出全部别名", async () => {
  const list = (await out("alias")) as string;
  assert.match(list, /alias ll='ls -l'/);
  assert.match(list, /alias la='ls -la'/);
});

test("别名能被 Tab 补全找到", async () => {
  const { VISIBLE_COMMANDS } = await import("../lib/terminal/commands.ts");
  for (const a of ["ll", "la", "l"]) assert.ok(VISIBLE_COMMANDS.includes(a), `${a} 不在补全列表里`);
});

test("ls -l: 大小是真的，目录和文件的权限位不同", async () => {
  const rows = ((await out("ls -l")) as string).split("\n");
  const fileRow = rows.find((r) => r.endsWith("a.txt"))!;
  const dirRow = rows.find((r) => r.endsWith("dir/"))!;

  // a.txt 的内容是 "alpha\nbeta\nGamma" = 16 个字符
  assert.match(fileRow, /^-r--r--r-- {2}1 heimnad heimnad {5}16 Jul 29 20:33 a\.txt$/);
  assert.match(dirRow, /^dr-xr-xr-x/, "目录要有 d 和 x 位");
  assert.doesNotMatch(rows.join("\n"), /w/, "整个文件系统只读，不该有 w 权限位");
});

test("ls -l 的目录有真实时间，不是 epoch", async () => {
  const full: FSDir = { home: { [ME.user]: { d: { "x.txt": "hi" } } } };
  const map = toStatMap(full, { "d/x.txt": "2026-07-29T20:33:00.000Z" }, "2020-01-01T00:00:00.000Z");
  const dir = map[`home/${ME.user}/d`];
  assert.ok(dir, "目录也该有 stat 条目");
  assert.equal(dir.mtime, "2026-07-29T20:33:00.000Z", "目录继承子项里最新的时间");

  const rows = ((await out("ls -l")) as string).split("\n");
  assert.doesNotMatch(rows.join("\n"), /Jan 01 00:00/, "别退回 epoch");
});

test("ls -l 的大小按字符数算，中文不会算成三倍", async () => {
  const full: FSDir = { home: { [ME.user]: { "cn.txt": "终端" } } };
  const r = await execute("ls -l", ctxOf(full));
  assert.match(r.output as string, /\s2 Jul/, "两个汉字应该算 2，不是 UTF-8 的 6 字节");
});

test("curl 只认本站路径，带主机名的一律解析失败", async () => {
  // 这台机器没有对外网络，报错照抄真 curl 的编号
  assert.match((await err("curl https://example.com"))!, /\(6\) Could not resolve host: example\.com/);
  assert.match((await err("curl //evil.test/x"))!, /Could not resolve host: evil\.test/);
  assert.match((await err("curl example.com"))!, /Could not resolve host: example\.com/);
  assert.match((await err("curl relative/path"))!, /\(3\) URL rejected/);
  assert.match((await err("curl"))!, /用法/);

  // 本站路径原样传给 http
  assert.equal(await out("curl /api/posts"), "GET /api/posts");
  assert.equal(await out("curl /feed.xml"), "GET /feed.xml");
});

test("curl 的输出能进管道", async () => {
  assert.equal(await out("curl /api/me | grep GET"), "GET /api/me");
});

test("sl 返回动画标记，且藏在 help 之外", async () => {
  const r = await execute("sl", ctx());
  assert.equal(r.error, undefined);
  assert.deepEqual(r.output, { render: "sl" });

  const { COMMANDS } = await import("../lib/terminal/commands.ts");
  assert.equal(COMMANDS.sl.hidden, true, "彩蛋不该出现在 help 里");
  assert.doesNotMatch((await out("help")) as string, /\bsl\b/);
  // 动画不是文本，接管道要报错
  assert.match((await err("sl | wc -l"))!, /不能接管道/);
});

test("donutFrame: 尺寸固定、确定性、会随角度变", async () => {
  const { donutFrame } = await import("../lib/terminal/donut.ts");

  const f = donutFrame(1.0, 0.5);
  const lines = f.split("\n");
  assert.equal(lines.length, 24);
  for (const l of lines) assert.equal(l.length, 48, "每行都要补满，否则动画时会抖");

  // 纯函数：同样的角度必须给同样的结果
  assert.equal(donutFrame(1.0, 0.5), f);
  assert.notEqual(donutFrame(1.6, 0.9), f, "转了角度就该不一样");

  // 得画出东西来，而且有明有暗（说明光照在起作用，不是一坨实心）
  const ink = new Set(f.replace(/[\s\n]/g, ""));
  assert.ok(ink.size >= 5, `明暗层次太少: ${[...ink].join("")}`);
  assert.ok([...ink].every((c) => ".,-~:;=!*#$@".includes(c)), "出现了灰阶之外的字符");
});

test("donutFrame: 任何角度都不撞边框", async () => {
  const { donutFrame } = await import("../lib/terminal/donut.ts");
  // 撞边说明投影系数不对，画面会被切掉一块
  for (let a = 0; a < 6.3; a += 0.3) {
    for (let b = 0; b < 6.3; b += 0.3) {
      const lines = donutFrame(a, b).split("\n");
      assert.equal(lines[0].trim(), "", `a=${a.toFixed(1)} b=${b.toFixed(1)} 顶到第一行`);
      assert.equal(lines[lines.length - 1].trim(), "", "顶到最后一行");
      for (const l of lines) {
        assert.equal(l[0], " ", "顶到第一列");
        assert.equal(l[l.length - 1], " ", "顶到最后一列");
      }
    }
  }
});

test("help 和 man 从注册表元数据生成", async () => {
  const help = await out("help") as string;
  assert.match(help, /grep/);
  assert.doesNotMatch(help, /sudo/, "彩蛋不该出现在 help 里");
  assert.match(await out("man ls") as string, /SYNOPSIS\n {4}ls \[-al\]/);
  assert.match((await err("man nope"))!, /没有 nope 的手册页/);
});
