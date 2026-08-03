// sort / uniq / cut / tr。这四个是管道中间最常出现的，
// 行为对不对直接决定了"管道是真的"这句话站不站得住
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { cutLine, expandSet, parseRanges, sortLines, trText, uniqLines } from "../lib/terminal/textutils.ts";
import { ME } from "../lib/site/me.ts";
import { at, ctxOf } from "./fixtures.mts";
import type { FSDir } from "../lib/terminal/fs.ts";

// 自己的树：共用夹具里没有带分隔符的文件，而这四条命令要的就是那种内容。
// 用真站上的 skills.txt 是错的 —— 那个文件在夹具里不存在
const TREE: FSDir = {
  home: {
    [ME.user]: {
      "a.txt": "alpha\nbeta\nGamma",
      "skills.txt": "Language: C\nLanguage: Python\nLanguage: Java\nTool: git\nTool: vim",
    },
  },
};

const out = async (cmd: string) => {
  const r = await execute(cmd, ctxOf(TREE, at()));
  assert.equal(r.error, undefined, `意外报错: ${r.error}`);
  return r.output as string;
};

test("sort：默认字典序，-r 倒序", () => {
  assert.deepEqual(sortLines(["b", "a", "c"]), ["a", "b", "c"]);
  assert.deepEqual(sortLines(["b", "a", "c"], { reverse: true }), ["c", "b", "a"]);
});

test("sort -n 按数值，不是按字符串", () => {
  // 字典序会把 10 排在 9 前面，这正是 -n 存在的理由
  assert.deepEqual(sortLines(["10", "9", "100"]), ["10", "100", "9"]);
  assert.deepEqual(sortLines(["10", "9", "100"], { numeric: true }), ["9", "10", "100"]);
});

test("sort -u 去掉重复", () => {
  assert.deepEqual(sortLines(["b", "a", "b"], { unique: true }), ["a", "b"]);
});

test("uniq 只合并相邻的 —— 这就是为什么要先 sort", () => {
  // 不相邻的重复不合并，和真 uniq 一致
  assert.deepEqual(uniqLines(["a", "b", "a"]), ["a", "b", "a"]);
  assert.deepEqual(uniqLines(["a", "a", "b"]), ["a", "b"]);
});

test("uniq -c 报次数，-d 只留重复过的，-u 只留没重复的", () => {
  const runs = ["a", "a", "a", "b", "c", "c"];
  assert.deepEqual(uniqLines(runs, { count: true }), ["      3 a", "      1 b", "      2 c"]);
  assert.deepEqual(uniqLines(runs, { onlyDup: true }), ["a", "c"]);
  assert.deepEqual(uniqLines(runs, { onlyUniq: true }), ["b"]);
});

test("parseRanges 认单个、逗号和区间", () => {
  assert.deepEqual(parseRanges("1"), [1]);
  assert.deepEqual(parseRanges("1,3"), [1, 3]);
  assert.deepEqual(parseRanges("2-4"), [2, 3, 4]);
  assert.deepEqual(parseRanges("1,3-5"), [1, 3, 4, 5]);
});

test("cut -f 按分隔符取字段", () => {
  assert.equal(cutLine("a:b:c", { delim: ":", fields: "2" }), "b");
  assert.equal(cutLine("a:b:c", { delim: ":", fields: "1,3" }), "a:c");
  // 不含分隔符的行整行输出 —— 真 cut 就是这样（除非给 -s）
  assert.equal(cutLine("nodelim", { delim: ":", fields: "2" }), "nodelim");
});

test("cut -c 按字符数，中文一个字算一个", () => {
  assert.equal(cutLine("abcdef", { chars: "2-4" }), "bcd");
  // 按 UTF-16 码元算的话这里会切错
  assert.equal(cutLine("你好世界", { chars: "2,3" }), "好世");
});

test("expandSet 展开区间和转义", () => {
  assert.deepEqual(expandSet("abc"), ["a", "b", "c"]);
  assert.deepEqual(expandSet("a-e"), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(expandSet("\\n"), ["\n"]);
  assert.deepEqual(expandSet("a-"), ["a", "-"], "末尾的 - 是普通字符");
});

test("tr 映射、删除、压缩", () => {
  assert.equal(trText("hello", "a-z", "A-Z"), "HELLO");
  assert.equal(trText("hello", "l", "", { delete: true }), "heo");
  assert.equal(trText("aaabbb", "ab", "xy", { squeeze: true }), "xy");
  // set2 比 set1 短时，多出来的映射到最后一个 —— 和真 tr 一样
  assert.equal(trText("abc", "abc", "x"), "xxx");
});

test("四条命令串起来真的能跑", async () => {
  // 这句是这个功能存在的理由
  const counted = await out("cat skills.txt | cut -d: -f1 | sort | uniq -c");
  assert.match(counted, /3 Language/);
  assert.match(counted, /2 Tool/);
});

test("命令层的选项解析：-d: 和 -d : 都认", async () => {
  assert.equal(await out("cat a.txt | cut -c1"), "a\nb\nG");
  assert.equal(await out("cat skills.txt | cut -d: -f1 | uniq"), "Language\nTool");
  assert.equal(await out("cat skills.txt | cut -d : -f 1 | uniq"), "Language\nTool");
  assert.equal(await out("cat skills.txt | cut -d ':' -f 1 | uniq"), "Language\nTool");
  // 空格当分隔符 —— 没有引号的话这个根本写不出来，也是加引号解析的直接原因
  assert.equal(await out("cat skills.txt | cut -d ' ' -f2 | uniq"), "C\nPython\nJava\ngit\nvim");
});

test("tr 只收标准输入，给了文件名也要说清楚", async () => {
  const r = await execute("tr a-z A-Z", ctxOf(TREE, at()));
  assert.match(r.error!, /只读标准输入/);
  assert.equal(await out("cat a.txt | tr a-z A-Z"), "ALPHA\nBETA\nGAMMA");
});

test("cut 没给 -f 或 -c 要报错，不静默输出原文", async () => {
  const r = await execute("cat a.txt | cut", ctxOf(TREE, at()));
  assert.match(r.error!, /得给 -f 或 -c/);
});
