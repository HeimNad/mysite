// 历史展开和反向搜索。都发生在命令执行之前，是 shell 的活 ——
// "Ctrl+R 真的接管了键盘"归 e2e 验，这里只管选出来的对不对
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandHistory, searchBack } from "../lib/terminal/history.ts";

const H = ["ls -la", "cat about.txt", "git status", "cat skills.txt", "whoami"];

/** 展开成功时的命令，失败就抛 —— 让断言写起来短一点 */
const ex = (input: string, history = H) => {
  const r = expandHistory(input, history);
  if ("error" in r) throw new Error(r.error);
  return r.command;
};

test("!! 是上一条", () => {
  assert.equal(ex("!!"), "whoami");
  // 参数原样接上，所以 !! | grep x 成立
  assert.equal(ex("!! | wc -l"), "whoami | wc -l");
});

test("!n 按 history 的编号，从 1 开始", () => {
  assert.equal(ex("!1"), "ls -la");
  assert.equal(ex("!3"), "git status");
  // !-2 是倒数第二条，和 bash 一样
  assert.equal(ex("!-1"), "whoami");
  assert.equal(ex("!-2"), "cat skills.txt");
});

test("!前缀 给最近的那条，不是最早的", () => {
  assert.equal(ex("!cat"), "cat skills.txt", "两条 cat，要最近那条");
  assert.equal(ex("!g"), "git status");
});

test("找不到时报 event not found，不静默执行别的", () => {
  const r = expandHistory("!nope", H);
  assert.ok("error" in r);
  assert.match((r as { error: string }).error, /!nope: event not found/);

  assert.ok("error" in expandHistory("!!", []), "历史是空的时候 !! 也没得展开");
});

test("普通命令原样通过，单独的 ! 不算展开", () => {
  assert.equal(ex("ls -la"), "ls -la");
  const bare = expandHistory("!", H);
  assert.deepEqual(bare, { command: "!", expanded: false }, "单独一个 ! 在 bash 里是普通字符");
  assert.deepEqual(expandHistory("echo hi!", H), { command: "echo hi!", expanded: false });
});

test("展开与否要报出来 —— 回显和存历史都用展开后的", () => {
  assert.deepEqual(expandHistory("ls", H), { command: "ls", expanded: false });
  assert.deepEqual(expandHistory("!!", H), { command: "whoami", expanded: true });
});

test("searchBack 从指定位置往回找最近的一条", () => {
  assert.equal(searchBack(H, "cat", H.length), 3, "最近的 cat 是 skills");
  assert.equal(searchBack(H, "cat", 3), 1, "再往前一条是 about");
  assert.equal(searchBack(H, "cat", 1), -1, "前面没有了");
});

test("searchBack 大小写不敏感，空词不匹配任何东西", () => {
  assert.equal(searchBack(H, "GIT", H.length), 2);
  assert.equal(searchBack(H, "", H.length), -1, "空搜索词不该命中第一条");
  assert.equal(searchBack([], "x", 0), -1);
});

test("searchBack 匹配的是子串，不只是前缀", () => {
  assert.equal(searchBack(H, "about", H.length), 1);
  assert.equal(searchBack(H, "-la", H.length), 0);
});
