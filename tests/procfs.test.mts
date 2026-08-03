// /proc 和 uname/free/df。重点只有一个：拿不到的值必须是字面量 null，
// 不能是 0、不能是"未知"、更不能是一个看着合理的编造数字。
//
// Safari/iOS 实测拿不到 deviceMemory 和 performance.memory，所以"一半 null"
// 是真实会发生的情况，不是假想的边界
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { cpuinfo, dfTable, freeTable, human, meminfo, PROC_FILES, selfStatus, uptimeFile, versionFile } from "../lib/terminal/procfs.ts";
import type { Machine } from "../lib/terminal/procfs.ts";
import { VERSION } from "../lib/site/me.ts";
import { at, ctxOf, FIXED_MACHINE, ROOT } from "./fixtures.mts";

/** Safari 上的样子：核数和存储配额有，内存全线拿不到 */
const SAFARI: Machine = {
  ...FIXED_MACHINE,
  memoryGB: null,
  heapUsed: null,
  heapLimit: null,
};

test("human 按 1024 进制，null 原样传下去", () => {
  assert.equal(human(0), "0B");
  assert.equal(human(1536), "1.5K");
  assert.equal(human(3 * 1024 ** 3), "3.0G");
  assert.equal(human(null), "null");
});

test("cpuinfo 每个逻辑核一段 —— grep processor | wc -l 得数得对", () => {
  const text = cpuinfo(FIXED_MACHINE);
  assert.equal(text.split("\n").filter((l) => l.startsWith("processor")).length, 4);
  // 型号浏览器不报，那就是 null
  assert.match(text, /model name\s+: null/);
});

test("拿不到的内存写 null，不写 0 也不写别的", () => {
  const mem = meminfo(SAFARI);
  assert.match(mem, /MemTotal:\s+null$/m, "Safari 上 MemTotal 就是 null");
  assert.doesNotMatch(mem, /\b0 kB/, "别用 0 冒充拿不到");

  const status = selfStatus(SAFARI);
  assert.match(status, /VmRSS:\s+null/);

  const free = freeTable(SAFARI);
  assert.match(free, /Mem:\s+null/);
  assert.match(free, /Heap:\s+null\s+null\s+null/);
});

test("拿得到的时候是真数字", () => {
  assert.match(meminfo(FIXED_MACHINE), /MemTotal:\s+8388608 kB/); // 8 GB
  assert.match(selfStatus(FIXED_MACHINE), /VmRSS:\s+10240 kB/); // 10 MB
  assert.match(freeTable(FIXED_MACHINE), /Mem:\s+8\.0G/);
});

test("uptime 第一个数是真的，第二个浏览器不可能知道", () => {
  assert.equal(uptimeFile({ ...FIXED_MACHINE, uptimeMs: 83_000 }), "83.00 null");
});

test("version 里的版本号就是这份代码的 commit", () => {
  assert.ok(versionFile(FIXED_MACHINE).includes(VERSION));
});

test("df 的百分比按真实用量算，拿不到就 null", () => {
  const t = dfTable(FIXED_MACHINE, "/home/x");
  assert.match(t, /\/dev\/sda1\s+3\.0G/);
  assert.match(t, /0%/, "1.5K / 3G 约等于 0%");
  assert.match(t, /\/home\/x$/m, "挂载点要显示出来");

  const blind = dfTable({ ...FIXED_MACHINE, storageQuota: null, storageUsage: null }, "/home/x");
  assert.match(blind, /null\s+null\s+null\s+null/);
});

test("PROC_FILES 覆盖了树里列出的每个文件", async () => {
  const ctx = ctxOf(ROOT, at());
  for (const name of Object.keys(PROC_FILES)) {
    const text = PROC_FILES[name](FIXED_MACHINE);
    assert.ok(text.length > 0, `/proc/${name} 是空的`);
  }
  // uname 走命令层，确认它接得上
  assert.match((await execute("uname -a", ctx)).output as string, new RegExp(VERSION));
});

test("free 和 df 是异步命令，也要能进管道", async () => {
  const ctx = ctxOf(ROOT, at());
  const r = await execute("df | grep sda1 | wc -l", ctx);
  assert.equal(r.error, undefined, `意外报错: ${r.error}`);
  assert.match(r.output as string, /1/);
});
