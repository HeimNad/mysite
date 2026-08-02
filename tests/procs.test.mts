// ps / kill。这台机器上"跑着的东西"是页面上真实存在的定时器，
// 所以这里只测排版和语义，"kill 真的停住了火车"由 e2e 验
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { elapsed, INIT_PID, psTable } from "../lib/terminal/procs.ts";
import { at, ctxOf, FIXED_NOW, ROOT } from "./fixtures.mts";

const init = { pid: INIT_PID, cmd: "hnsh", startedAt: 0 };

test("elapsed 按 ps -o etime 的样子格式化", () => {
  assert.equal(elapsed(0), "00:00");
  assert.equal(elapsed(2_000), "00:02");
  assert.equal(elapsed(83_000), "01:23");
  assert.equal(elapsed(3_600_000), "1:00:00", "过一小时要带小时段");
  assert.equal(elapsed(-5), "00:00", "时钟倒退也不该出负数");
});

test("ps 按 pid 排序，ELAPSED 是真时长", () => {
  const table = psTable([{ pid: 7, cmd: "sl", startedAt: 80_000 }, init], FIXED_NOW);
  const rows = table.split("\n");
  assert.match(rows[0], /PID\s+TTY\s+ELAPSED\s+CMD/);
  // 头衔是 ELAPSED 不是 TIME：CPU 时间在浏览器里量不到，写 TIME 就是假的
  assert.doesNotMatch(rows[0], /\bTIME\b/);
  assert.match(rows[1], /^\s+1 pts\/0\s+01:23 hnsh$/, "1 号在最前，跑了 83 秒");
  assert.match(rows[2], /^\s+7 pts\/0\s+00:03 sl$/);
});

test("ps 列出真在跑的东西", async () => {
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map(), [
    init,
    { pid: 5, cmd: "donut", startedAt: 82_000 },
  ]);
  const outText = (await execute("ps", ctx)).output as string;
  assert.match(outText, /hnsh/);
  assert.match(outText, /donut/);
});

test("kill 真的停掉那个进程", async () => {
  const killed: number[] = [];
  const procs = [init, { pid: 5, cmd: "donut", startedAt: 0 }];
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map(), procs, killed);

  assert.equal((await execute("kill 5", ctx)).error, undefined);
  assert.deepEqual(killed, [5], "kill 回调要拿到那个 pid");

  // 已经没了，再杀一次就是 No such process
  assert.match((await execute("kill 5", ctx)).error!, /没有那个进程/);
});

test("1 号进程杀不掉，除非 -9 —— 那样内核就 panic", async () => {
  const panics: string[] = [];
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map(), [init], [], panics);

  assert.match((await execute("kill 1", ctx)).error!, /不允许的操作/);
  assert.equal(panics.length, 0, "没加 -9 就不该崩");

  assert.equal((await execute("kill -9 1", ctx)).error, undefined);
  assert.match(panics[0], /Kernel panic.*Attempted to kill init/);
});

test("kill 的参数要说人话", async () => {
  const ctx = ctxOf(ROOT);
  assert.match((await execute("kill", ctx)).error!, /用法/);
  assert.match((await execute("kill abc", ctx)).error!, /进程号/);
  assert.match((await execute("kill 999", ctx)).error!, /没有那个进程/);
});
