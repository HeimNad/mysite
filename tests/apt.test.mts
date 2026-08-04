// apt 和包门禁。核心是"没装等于不存在"这条 —— 它同时管着命令查找、
// help 列表和 Tab 补全，漏一处就会出现"help 里看得见但敲了说没有"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execute } from "../lib/terminal/shell.ts";
import { visibleCommands } from "../lib/terminal/commands.ts";
import { PACKAGES } from "../lib/terminal/packages.ts";
import { ME } from "../lib/site/me.ts";
import { at, ctxOf, ROOT } from "./fixtures.mts";

const FONT_PATH = "public/apt/pool/universe/f/figlet/figlet_2.2.5-3.flf";

/** 一个装了 figlet 的 ctx：内容用真字体，和线上装完的状态一致 */
async function withFiglet() {
  const font = await readFile(FONT_PATH, "utf8");
  return ctxOf(ROOT, at(), [], "zh", new Map([["figlet", font]]));
}

const run = (cmd: string, ctx: ReturnType<typeof ctxOf>) => execute(cmd, ctx);

test("没装的时候 figlet 处处都不存在", async () => {
  const ctx = ctxOf(ROOT);

  // 照抄 Ubuntu 的 command-not-found —— 它就是这套包管理的发现机制
  const r = await run("figlet hi", ctx);
  assert.match(r.error!, /Command 'figlet' not found/);
  assert.match(r.error!, /sudo apt install figlet/);

  const help = (await run("help", ctx)).output as string;
  assert.doesNotMatch(help, /figlet/, "help 里不该列出没装的命令");

  assert.ok(!visibleCommands(new Map()).includes("figlet"), "Tab 也不该补出来");
});

test("装了之后 figlet 到处都在", async () => {
  const ctx = await withFiglet();

  assert.match((await run("help", ctx)).output as string, /figlet/);
  assert.ok(visibleCommands(new Map([["figlet", "x"]])).includes("figlet"));

  const art = (await run("figlet hi", ctx)).output as string;
  assert.equal(art.split("\n").length, 6, "Standard 字体高 6 行");
  assert.match(art, /\|_\|/, "该是字符画而不是原文");
});

test("figlet 能接管道 —— 命令返回字符串才有这个", async () => {
  const ctx = await withFiglet();
  const piped = (await run("whoami | figlet", ctx)).output as string;
  const direct = (await run(`figlet ${ME.user}`, ctx)).output as string;
  assert.equal(piped, direct, "管道进来的文本和直接给的参数结果一致");
});

test("装东西要 root，不加 sudo 给的是 dpkg 的锁错误", async () => {
  const ctx = ctxOf(ROOT);
  const r = await run("apt install figlet", ctx);
  assert.match(r.error!, /权限不够/);
  assert.match(r.error!, /请查看您是否正以 root 用户运行/);
  assert.ok(!ctx.pkgs.has("figlet"), "失败了就不该装上");
});

test("sudo apt install 走完整个流程，数字来自真实下载", async () => {
  const ctx = ctxOf(ROOT);
  const outText = (await run("sudo apt install figlet", ctx)).output as string;

  assert.match(outText, /正在读取软件包列表\.\.\. 完成/);
  assert.match(outText, /下列【新】软件包将被安装：/);
  // 获取: 那一行必须是真地址，而且和包表里登记的一致
  assert.ok(
    outText.includes(PACKAGES.figlet.path),
    `获取: 行要带真实路径，实际是:\n${outText}`
  );
  assert.match(outText, /正在设置 figlet \(2\.2\.5-3\) \.\.\./);
  assert.ok(ctx.pkgs.has("figlet"), "装完 ctx 里要有它");
});

test("sudo 只借给 apt，别的照旧不在 sudoers 里", async () => {
  const ctx = ctxOf(ROOT);
  assert.match((await run("sudo ls", ctx)).error!, /sudoers/);
  assert.match((await run("sudo rm -rf /", ctx)).error!, /nice try/);
});

test("重复装和装不存在的包，说的都是 apt 的话", async () => {
  const again = (await run("sudo apt install figlet", await withFiglet())).output as string;
  assert.match(again, /已经是最新版/);

  // vim 现在是真包了，换一个确实不存在的
  const missing = await run("sudo apt install emacs", ctxOf(ROOT));
  assert.match(missing.error!, /E: 无法定位软件包 emacs/);
});

test("apt list 列出包，装了的标 [已安装]", async () => {
  assert.doesNotMatch((await run("apt list", ctxOf(ROOT))).output as string, /\[installed\]/);
  assert.match((await run("apt list", await withFiglet())).output as string, /figlet[\s\S]*\[已安装\]/);
});

test("没有 uninstall 这个子命令 —— 真 apt 也没有", async () => {
  // 真 apt 敲 uninstall 就是这一行，不是一段用法提示
  assert.match((await run("sudo apt uninstall figlet", ctxOf(ROOT))).error!, /^E: 无效的操作 uninstall$/);
  assert.match((await run("apt frobnicate", ctxOf(ROOT))).error!, /无效的操作 frobnicate/);
});

test("remove 真的卸掉：命令跟着一起消失", async () => {
  const ctx = await withFiglet();
  assert.match((await run("figlet hi", ctx)).output as string, /\|_\|/, "先确认装着的时候能用");

  const outText = (await run("sudo apt remove figlet", ctx)).output as string;
  assert.match(outText, /下列软件包将被【卸载】：/);
  assert.match(outText, /要卸载 1 个软件包/);
  assert.match(outText, /解压缩后将会空出/, "腾出空间，不是占用空间");
  assert.match(outText, /正在卸载 figlet \(2\.2\.5-3\) \.\.\./);

  assert.ok(!ctx.pkgs.has("figlet"), "ctx 里真的没了");
  assert.match((await run("figlet hi", ctx)).error!, /Command 'figlet' not found/);
  assert.doesNotMatch((await run("help", ctx)).output as string, /figlet/);
});

test("purge 和 remove 一样能卸，卸没装的包不报错", async () => {
  const ctx = await withFiglet();
  assert.match((await run("sudo apt purge figlet", ctx)).output as string, /正在卸载 figlet/);
  // 真 apt 对已经没装的包是提示不是错误
  const again = await run("sudo apt purge figlet", ctx);
  assert.equal(again.error, undefined);
  assert.match(again.output as string, /未安装，所以不会被卸载/);
});

test("卸载也要 root", async () => {
  const ctx = await withFiglet();
  assert.match((await run("apt remove figlet", ctx)).error!, /请查看您是否正以 root 用户运行/);
  assert.ok(ctx.pkgs.has("figlet"), "没卸成就该还在");
});

test("输出跟着站点语言走 —— 真 apt 也是 gettext 本地化的", async () => {
  const zh = (await run("sudo apt install figlet", ctxOf(ROOT, at(), [], "zh"))).output as string;
  const en = (await run("sudo apt install figlet", ctxOf(ROOT, at(), [], "en"))).output as string;

  // 译文逐字取自 Debian 的 po 文件，不是我自己译的
  assert.match(zh, /正在读取软件包列表\.\.\. 完成/);
  assert.match(zh, /下列【新】软件包将被安装：/);
  assert.match(zh, /^获取:1 /m, "Get: 在中文 apt 里是 获取:");
  assert.match(zh, /已下载 .*，耗时 \d+秒/);
  assert.match(zh, /正在设置 figlet/);
  assert.doesNotMatch(zh, /Reading package lists/, "中文里不该混英文原文");

  assert.match(en, /Reading package lists\.\.\. Done/);
  assert.doesNotMatch(en, /[一-龥]/, "英文里不该混中文");

  // 错误信息也是本地化的
  assert.match((await run("apt install figlet", ctxOf(ROOT, at(), [], "zh"))).error!, /请查看您是否正以 root 用户运行/);
  assert.match((await run("sudo apt install emacs", ctxOf(ROOT, at(), [], "zh"))).error!, /E: 无法定位软件包 emacs/);
});

test("每个包登记的文件都真实存在，大小也对得上", async () => {
  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const body = await readFile("public" + pkg.path, "utf8");
    assert.ok(body.length > 0, `${name} 的文件是空的`);
    // apt 输出里说的"解压后占用"不该比文件本身还小，否则那个数字没意义
    assert.ok(pkg.installedSize >= body.length, `${name} 的 installedSize 比文件还小`);
  }
});

test("程序包不能带 process —— 它在浏览器里是裸跑的", async () => {
  // htop 曾经通过 procfs.ts 拽进了 me.ts 的模块级 process.env，
  // 装上之后一敲就是 "process is not defined"
  for (const name of ["vim", "htop"]) {
    const code = await readFile("public" + PACKAGES[name].path, "utf8");
    assert.doesNotMatch(code, /\bprocess\b/, `${name} 的包里有 process，浏览器里会炸`);
    assert.doesNotMatch(code, /\brequire\(/, `${name} 的包里有 require`);
  }
});

test("包是当前源码编出来的 —— 改了没重跑 npm run apt 就会红", async () => {
  const { build } = await import("esbuild");
  for (const [name, entry] of [
    ["vim", "lib/terminal/vim.ts"],
    ["htop", "lib/terminal/htop.ts"],
  ] as const) {
    const r = await build({
      entryPoints: [entry], bundle: true, format: "esm",
      target: "es2022", minify: true, write: false, outfile: "x.js",
    });
    const onDisk = await readFile("public" + PACKAGES[name].path, "utf8");
    assert.equal(
      r.outputFiles[0].text, onDisk,
      `${name} 的包和源码对不上 —— 跑一下 npm run apt`
    );
  }
});
