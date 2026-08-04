// git log / pbcopy / ping。三个都靠真数据：提交历史来自 GitHub API，
// 剪贴板真的写，往返时延真的量
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { ME } from "../lib/site/me.ts";
import gitlog from "../lib/site/gitlog.json" with { type: "json" };
import { displayWidth } from "../lib/terminal/text.ts";
import { at, ctxOf, FIXED_RTT, ROOT } from "./fixtures.mts";

const out = async (cmd: string, ctx = ctxOf(ROOT, at())) => {
  const r = await execute(cmd, ctx);
  assert.equal(r.error, undefined, `意外报错: ${r.error}`);
  return r.output as string;
};
const err = async (cmd: string) => (await execute(cmd, ctxOf(ROOT, at()))).error;

test("gitlog.json 是真提交，不是占位数据", () => {
  assert.ok(gitlog.commits.length > 0);
  for (const c of gitlog.commits) {
    assert.match(c.sha, /^[0-9a-f]{7}$/, "短 sha");
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(c.subject.length > 0, "标题不该是空的");
  }
  assert.match(gitlog.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("git log 列真提交，并写明数据停在哪一刻", async () => {
  const text = await out("git log");
  const first = gitlog.commits[0];
  assert.ok(text.includes(first.sha), "第一条提交要在里面");
  assert.ok(text.includes(first.subject), "标题要在里面");
  assert.match(text, /抓取于 \d{4}-\d{2}-\d{2}/, "得说清楚它有多旧");
});

test("作者列按最长的撑开 —— dependabot[bot] 不该把标题挤歪", async () => {
  const text = await out("git log -n 20");
  const rows = text.split("\n").filter((l) => /^[0-9a-f]{7} /.test(l));
  // 每一行的标题都从同一个显示列开始
  const starts = rows.map((l) => {
    const m = /^[0-9a-f]{7}  \d{4}-\d{2}-\d{2}  (.*)$/.exec(l)!;
    return displayWidth(l) - displayWidth(m[1].replace(/^\S+\s+/, ""));
  });
  assert.equal(new Set(starts).size, 1, `标题列没对齐:\n${rows.join("\n")}`);
});

test("git log -n 限制条数", async () => {
  const three = (await out("git log -n 3")).split("\n").filter((l) => /^[0-9a-f]{7} /.test(l));
  assert.equal(three.length, 3);
  assert.equal((await out("git log -n 1")).split("\n")[0].slice(0, 7), gitlog.commits[0].sha);
});

test("git 只有 log —— 这里没有工作区，别的子命令没意义", async () => {
  assert.match((await err("git status"))!, /只有 log/);
  assert.match((await err("git"))!, /只有 log/);
});

test("pbcopy 真的把内容交出去，不是打印一句已复制", async () => {
  const copied: string[] = [];
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map(), undefined, [], [], undefined, [], [], [], copied);
  const text = await out("cat a.txt | pbcopy", ctx);
  assert.deepEqual(copied, ["alpha\nbeta\nGamma"], "剪贴板拿到的是原文");
  assert.match(text, /已复制 16 个字符/);
});

test("pbcopy 按字符数算，中文不会算成两倍", async () => {
  const copied: string[] = [];
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map(), undefined, [], [], undefined, [], [], [], copied);
  assert.match(await out("echo 你好世界 | pbcopy", ctx), /已复制 4 个字符/);
});

test("pbcopy 没有标准输入时说人话", async () => {
  assert.match((await err("pbcopy"))!, /用管道喂给它/);
});

test("ping 报的是量出来的时延和真实统计", async () => {
  const text = await out("ping 3");
  const lines = text.split("\n").filter((l) => l.includes("icmp_seq"));
  assert.equal(lines.length, 3);
  assert.match(text, new RegExp(`PING ${ME.host}`));
  assert.match(text, /3 packets transmitted, 3 received, 0% packet loss/);
  assert.match(text, new RegExp(`min/avg/max = ${FIXED_RTT}/${FIXED_RTT}/${FIXED_RTT} ms`));
});

test("ping 的次数有上下限，别让人跑一万次", async () => {
  const many = (await out("ping 999")).split("\n").filter((l) => l.includes("icmp_seq"));
  assert.equal(many.length, 10, "封顶 10 次");
  assert.equal((await out("ping 0")).split("\n").filter((l) => l.includes("icmp_seq")).length, 4, "0 退回默认");
});

test("三个都能进管道", async () => {
  assert.match(await out("git log | head -2"), /^[0-9a-f]{7} /);
  assert.match(await out("ping 2 | grep icmp_seq | wc -l"), /2/);
});
