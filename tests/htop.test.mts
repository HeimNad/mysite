// htop 的排版和键位。重点是"没有的列就不显示" ——
// 每进程 CPU%、VIRT/RES、load average 浏览器都给不了，填上去的就是编的
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { htopKey, htopView, meter, percentMeter, type HtopInput } from "../lib/terminal/htop.ts";
import { INIT_PID, type Proc } from "../lib/terminal/procs.ts";
import { at, ctxOf, FIXED_MACHINE, ROOT } from "./fixtures.mts";

const PROCS: Proc[] = [
  { pid: INIT_PID, cmd: "hnsh", startedAt: 0 },
  { pid: 2, cmd: "sl", startedAt: 80_000 },
  { pid: 3, cmd: "donut", startedAt: 82_000 },
];

const input = (over: Partial<HtopInput> = {}): HtopInput => ({
  procs: PROCS,
  machine: FIXED_MACHINE,
  lagPercent: 12.5,
  state: { selected: 0 },
  now: 83_000,
  user: "heimnad",
  rows: 20,
  ...over,
});

test("计量条按比例填，数字压在右边", () => {
  const m = meter("Mem", 512 * 1024 ** 2, 1024 ** 3, 20);
  assert.match(m, /^Mem \[/);
  assert.match(m, /512\.0M\/1\.0G/);
  assert.match(percentMeter("CPU", 50, 20), /50\.0%/);
  // 条子比数字还窄时别写出方括号
  assert.equal(percentMeter("CPU", 50, 3).length, "CPU ".length + 5, "窄条也不该溢出");
});

test("拿不到就是空条加 null，不画一条假的", () => {
  assert.match(meter("Mem", null, null, 10), /Mem \[null {6}\]/);
  assert.match(percentMeter("CPU", null, 10), /CPU \[null {6}\]/);
  // 关键：不能出现 0.0% 这种"看着像真的"的兜底
  assert.doesNotMatch(percentMeter("CPU", null, 10), /0\.0%/);
});

test("表头只列量得到的东西", () => {
  const { header } = htopView(input());
  const text = header.join("\n");
  assert.match(text, /Tasks: 3/);
  assert.match(text, /Cores: 4/);
  assert.match(text, /Uptime: 01:23/);
  // 这些真 htop 有，但浏览器给不了 —— 一个都不该出现
  for (const absent of ["load average", "Swp", "VIRT", "RES", "SHR", "NI", "PRI"])
    assert.doesNotMatch(text, new RegExp(absent), `${absent} 量不到，不该显示`);
  assert.doesNotMatch(text, /CPU%/, "每进程 CPU% 量不到");
});

test("进程行是真数据：pid、命令、真实运行时长", () => {
  const { rows } = htopView(input());
  assert.equal(rows.length, 3);
  assert.match(rows[0], /^ {4}1 heimnad {3}R {5}01:23 {2}hnsh$/);
  assert.match(rows[1], /2 heimnad {3}R {5}00:03 {2}sl/);
});

test("↑↓ 选进程，选不出边界", () => {
  const down = htopKey({ selected: 0 }, "ArrowDown", PROCS);
  assert.deepEqual(down, { kind: "state", state: { selected: 1 } });
  assert.deepEqual(htopKey({ selected: 2 }, "j", PROCS), { kind: "state", state: { selected: 2 } });
  assert.deepEqual(htopKey({ selected: 0 }, "k", PROCS), { kind: "state", state: { selected: 0 } });
});

test("F9 杀的是选中那个，q/F10 退出", () => {
  assert.deepEqual(htopKey({ selected: 2 }, "F9", PROCS), { kind: "kill", pid: 3 });
  assert.deepEqual(htopKey({ selected: 1 }, "K", PROCS), { kind: "kill", pid: 2 });
  assert.equal(htopKey({ selected: 0 }, "q", PROCS).kind, "quit");
  assert.equal(htopKey({ selected: 0 }, "F10", PROCS).kind, "quit");
  // 认不出的键什么都不做
  assert.deepEqual(htopKey({ selected: 1 }, "z", PROCS), { kind: "state", state: { selected: 1 } });
});

test("进程表为空时 F9 不炸", () => {
  assert.deepEqual(htopKey({ selected: 0 }, "F9", []), { kind: "state", state: { selected: 0 } });
});

test("选中行不会指到不存在的行", () => {
  // 进程跑完消失后，选中下标可能超出范围
  const { selected } = htopView(input({ state: { selected: 9 } }));
  assert.equal(selected, 2, "夹到最后一行");
});

test("屏幕矮的时候只画放得下的", () => {
  assert.equal(htopView(input({ rows: 9 })).rows.length, 1);
});

test("Safari 上内存条是 null，不是 0", () => {
  const blind = { ...FIXED_MACHINE, heapUsed: null, heapLimit: null };
  const text = htopView(input({ machine: blind })).header.join("\n");
  assert.match(text, /Mem \[null/);
  assert.doesNotMatch(text, /0B\/0B/);
});

test("没装的时候 htop 不存在，装了才有", async () => {
  const bare = await execute("htop", ctxOf(ROOT, at()));
  assert.match(bare.error!, /Command 'htop' not found/);
  assert.match(bare.error!, /sudo apt install htop/);
});

test("htop 命令走 ctx.monitor，不产生行输出", async () => {
  const monitored: boolean[] = [];
  // htop 是 apt 装的，没装的时候命令根本不存在
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map([["htop", "3.3"]]), undefined, [], [], undefined, [], [], monitored);
  const r = await execute("htop", ctx);
  assert.equal(r.error, undefined, `意外报错: ${r.error}`);
  assert.equal(r.output, undefined, "htop 接管屏幕");
  assert.deepEqual(monitored, [true]);
});
