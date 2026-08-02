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
  assert.match(r.error!, /Permission denied/);
  assert.match(r.error!, /are you root\?/);
  assert.ok(!ctx.pkgs.has("figlet"), "失败了就不该装上");
});

test("sudo apt install 走完整个流程，数字来自真实下载", async () => {
  const ctx = ctxOf(ROOT);
  const outText = (await run("sudo apt install figlet", ctx)).output as string;

  assert.match(outText, /Reading package lists\.\.\. Done/);
  assert.match(outText, /The following NEW packages will be installed:/);
  // Get: 那一行必须是真地址，而且和包表里登记的一致
  assert.ok(
    outText.includes(PACKAGES.figlet.path),
    `Get: 行要带真实路径，实际是:\n${outText}`
  );
  assert.match(outText, /Setting up figlet \(2\.2\.5-3\) \.\.\./);
  assert.ok(ctx.pkgs.has("figlet"), "装完 ctx 里要有它");
});

test("sudo 只借给 apt，别的照旧不在 sudoers 里", async () => {
  const ctx = ctxOf(ROOT);
  assert.match((await run("sudo ls", ctx)).error!, /sudoers/);
  assert.match((await run("sudo rm -rf /", ctx)).error!, /nice try/);
});

test("重复装和装不存在的包，说的都是 apt 的话", async () => {
  const ctx = await withFiglet();
  const again = (await run("sudo apt install figlet", ctx)).output as string;
  assert.match(again, /already the newest version/);

  const missing = await run("sudo apt install vim", ctxOf(ROOT));
  assert.match(missing.error!, /E: Unable to locate package vim/);
});

test("apt list 列出包，装了的标 [installed]", async () => {
  assert.doesNotMatch((await run("apt list", ctxOf(ROOT))).output as string, /\[installed\]/);
  assert.match((await run("apt list", await withFiglet())).output as string, /figlet[\s\S]*\[installed\]/);
});

test("包表里登记的文件真实存在，大小也对得上", async () => {
  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const body = await readFile("public" + pkg.path, "utf8");
    assert.ok(body.length > 0, `${name} 的文件是空的`);
    // apt 输出里说的"解压后占用"不该比文件本身还小，否则那个数字没意义
    assert.ok(pkg.installedSize >= body.length, `${name} 的 installedSize 比文件还小`);
  }
});
