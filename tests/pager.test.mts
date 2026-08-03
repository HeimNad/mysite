// less 的状态机。这是这台机器上第一个接管键盘的程序 ——
// 键位、翻页边界、搜索都是纯逻辑，能在这里全测掉；
// "键盘真的归它了"归 e2e 验，那个只有真浏览器测得了
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { openPager, pagerKey, pagerView } from "../lib/terminal/pager.ts";
import { at, ctxOf, ROOT } from "./fixtures.mts";

/** 30 行，视口 10 行 —— 够翻两屏半 */
const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
const open = () => openPager(text, "f.txt", 10);

/** 连按一串键，返回最终状态（null 表示中途退出了） */
const press = (keys: string[]) =>
  keys.reduce<ReturnType<typeof openPager> | null>(
    (p, k) => (p === null ? null : pagerKey(p, k)),
    open()
  );

test("开头显示第一屏，状态行报位置", () => {
  const v = pagerView(open());
  assert.equal(v.body.length, 10);
  assert.equal(v.body[0], "line 1");
  assert.equal(v.body[9], "line 10");
  assert.match(v.status, /f\.txt\s+1-10\/30\s+33%/);
});

test("空格翻一屏，b 翻回来 —— 留一行重叠", () => {
  const down = pagerKey(open(), " ")!;
  assert.equal(pagerView(down).body[0], "line 10", "翻页留一行重叠，不然容易看丢");
  const back = pagerKey(down, "b")!;
  assert.equal(pagerView(back).body[0], "line 1");
});

test("j/k 和方向键一行一行走", () => {
  assert.equal(pagerView(press(["j", "j", "j"])!).body[0], "line 4");
  assert.equal(pagerView(press(["ArrowDown", "ArrowDown", "ArrowUp"])!).body[0], "line 2");
});

test("翻不出边界：顶上再往上是顶，底下再往下是底", () => {
  assert.equal(pagerView(press(["k", "k", "k"])!).body[0], "line 1");
  const bottom = pagerKey(open(), "G")!;
  assert.equal(pagerView(bottom).body[0], "line 21", "最后一屏起点是 30-10+1");
  assert.equal(pagerView(pagerKey(bottom, " ")!).body[0], "line 21", "到底了就不动");
  assert.match(pagerView(bottom).status, /\(END\)/);
  assert.equal(pagerView(pagerKey(bottom, "g")!).body[0], "line 1");
});

test("q 和 Esc 退出，返回 null", () => {
  assert.equal(pagerKey(open(), "q"), null);
  assert.equal(pagerKey(open(), "Escape"), null);
  // 认不出的键什么都不做，和真 less 一样
  assert.deepEqual(pagerKey(open(), "z"), open());
});

test("/ 进搜索，回车跳过去把匹配行显示出来", () => {
  const typing = press(["/", "1", "8"])!;
  assert.equal(pagerView(typing).status, "/18", "输入中状态行显示搜索词");

  const found = pagerKey(typing, "Enter")!;
  assert.equal(pagerView(found).body[0], "line 18", "够得着就把匹配行放到顶上");
  assert.equal(found.typing, null, "回车后退出输入态");

  // 匹配落在最后一屏时翻不过文件末尾 —— 真 less 也是显示最后一屏，
  // 匹配行可见但不在顶端。这里只要求"看得见"
  const nearEnd = press(["/", "2", "8", "Enter"])!;
  assert.ok(pagerView(nearEnd).body.includes("line 28"), "匹配行必须在视口里");
  assert.match(pagerView(nearEnd).status, /\(END\)/);
});

test("搜不到时说搜不到，不静默不动", () => {
  const miss = press(["/", "x", "y", "z", "Enter"])!;
  assert.match(pagerView(miss).status, /Pattern not found/);
  assert.equal(pagerView(miss).body[0], "line 1", "位置不动");
});

test("n/N 在匹配之间来回", () => {
  // 用 5 而不是 2：line 2 是 line 20..29 的子串，会把"下一个"测糊
  const first = press(["/", "5", "Enter"])!;
  assert.equal(pagerView(first).body[0], "line 5");
  const next = pagerKey(first, "n")!;
  assert.equal(pagerView(next).body[0], "line 15", "下一个含 5 的是 15");
  assert.equal(pagerView(pagerKey(next, "N")!).body[0], "line 5", "N 往回找");
});

test("Esc 取消搜索输入，不当成退出", () => {
  const typing = press(["/", "a", "b"])!;
  const cancelled = pagerKey(typing, "Escape");
  assert.notEqual(cancelled, null, "输入态里的 Esc 只取消搜索");
  assert.equal(cancelled!.typing, null);
});

test("内容不足一屏时补空行，状态行不往上跳", () => {
  const short = openPager("a\nb", "s.txt", 10);
  const v = pagerView(short);
  assert.equal(v.body.length, 10);
  assert.match(v.status, /1-2\/2\s+\(END\)/);
});

test("less 命令把文本交给 ctx.page，不自己打印", async () => {
  const paged: { text: string; name: string }[] = [];
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map(), undefined, [], [], undefined, paged);

  const r = await execute("less a.txt", ctx);
  assert.equal(r.error, undefined, `意外报错: ${r.error}`);
  assert.equal(r.output, undefined, "less 不产生行输出，它接管屏幕");
  assert.deepEqual(paged, [{ text: "alpha\nbeta\nGamma", name: "a.txt" }]);

  // 管道进来的没有文件名
  paged.length = 0;
  await execute("cat a.txt | less", ctx);
  assert.equal(paged[0].name, "(stdin)");
});
