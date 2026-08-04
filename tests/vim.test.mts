// vim 的状态机。移动、编辑、撤销、模式切换全是纯逻辑，能在这里测掉；
// "键盘真的归它了""输入法能打中文"归 e2e
import { test } from "node:test";
import assert from "node:assert/strict";
import { execute } from "../lib/terminal/shell.ts";
import { insertText, openVim, vimKey, vimView, type Vim } from "../lib/terminal/vim.ts";
import { at, ctxOf, ROOT } from "./fixtures.mts";

const open = () => openVim("alpha\nbeta\nGamma", "a.txt", 10);

/** 连按一串键 */
const press = (keys: string[], from: Vim = open()) =>
  keys.reduce<Vim | null>((v, k) => (v === null ? null : vimKey(v, k)), from);

const text = (v: Vim) => v.lines.join("\n");

test("开场在左上角，普通模式，状态行报文件名和大小", () => {
  const v = open();
  assert.equal(v.mode, "normal");
  assert.deepEqual([v.row, v.col], [0, 0]);
  assert.match(vimView(v).status, /"a\.txt" 3L, 16B/);
});

test("hjkl 移动，光标不许跑出内容", () => {
  assert.deepEqual(pos(press(["j", "l", "l"])!), [1, 2]);
  assert.deepEqual(pos(press(["k", "k", "k"])!), [0, 0], "顶上再往上还是顶");
  assert.deepEqual(pos(press(["j", "j", "j", "j"])!), [2, 0], "底下再往下还是底");
  // 普通模式停在最后一个字符上，不是末尾之后
  assert.deepEqual(pos(press(["$"])!), [0, 4], "alpha 的最后一个字符下标是 4");
});

test("0 / $ / gg / G", () => {
  assert.deepEqual(pos(press(["l", "l", "0"])!), [0, 0]);
  assert.deepEqual(pos(press(["G"])!), [2, 0]);
  assert.deepEqual(pos(press(["G", "g", "g"])!), [0, 0]);
});

test("w / b 按词跳，跨行也认", () => {
  const v = openVim("one two three\nnext", "x", 10);
  assert.deepEqual(pos(press(["w"], v)!), [0, 4]);
  assert.deepEqual(pos(press(["w", "w"], v)!), [0, 8]);
  assert.deepEqual(pos(press(["w", "w", "w"], v)!), [1, 0], "行尾再 w 跳下一行");
  assert.deepEqual(pos(press(["j", "b"], v)!), [0, 8], "行首 b 回上一行最后一个词的词首");
});

test("i / a / I / A 进插入模式，落点不同", () => {
  assert.equal(press(["i"])!.mode, "insert");
  assert.deepEqual(pos(press(["l", "a"])!), [0, 2], "a 落在光标之后");
  assert.deepEqual(pos(press(["l", "l", "I"])!), [0, 0]);
  assert.deepEqual(pos(press(["A"])!), [0, 5], "A 到行尾之后，插入模式允许");
});

test("插入文字、回车分行、退格合行", () => {
  const typed = press(["i", "X", "Y"])!;
  assert.equal(text(typed).split("\n")[0], "XYalpha");
  assert.equal(typed.dirty, true);

  const split = press(["l", "l", "i", "Enter"])!;
  assert.deepEqual(split.lines.slice(0, 2), ["al", "pha"]);

  // 行首退格把两行接起来
  const joined = press(["j", "I", "Backspace"])!;
  assert.equal(joined.lines[0], "alphabeta");
});

test("o / O 开新行并进插入模式", () => {
  const below = press(["o"])!;
  assert.deepEqual(below.lines, ["alpha", "", "beta", "Gamma"]);
  assert.deepEqual([below.row, below.mode], [1, "insert"]);

  const above = press(["O"])!;
  assert.deepEqual(above.lines[0], "");
  assert.equal(above.row, 0);
});

test("x 删字符，dd 删行", () => {
  assert.equal(press(["x"])!.lines[0], "lpha");
  assert.deepEqual(press(["d", "d"])!.lines, ["beta", "Gamma"]);
  // 删光了要留一行空的，不能变成没有行
  const empty = press(["d", "d", "d", "d", "d", "d"])!;
  assert.deepEqual(empty.lines, [""]);
});

test("u 撤销，撤到底会说话", () => {
  const undone = press(["x", "u"])!;
  assert.equal(undone.lines[0], "alpha");
  assert.match(vimView(press(["u"])!).status, /oldest change/);
});

test("Esc 回普通模式，光标左移一格 —— 和真 vim 一样", () => {
  const v = press(["i", "a", "b", "Escape"])!;
  assert.equal(v.mode, "normal");
  assert.equal(v.col, 1, "插入完在 2，Esc 之后退到 1");
});

test(":w 一定失败 —— 这个文件系统是只读的", () => {
  const v = press([":", "w", "Enter"])!;
  assert.match(vimView(v).status, /E45: 'readonly' option is set/);
  assert.equal(v.mode, "normal");
  // :w! 也不行，因为真的没有写的路径
  assert.match(vimView(press([":", "w", "!", "Enter"])!).status, /E45/);
});

test(":q 在改过之后会拦，:q! 不拦", () => {
  assert.equal(press([":", "q", "Enter"]), null, "没改过直接退");

  const dirty = press(["x"])!;
  const blocked = vimKey(dirty, ":") as Vim;
  const after = press(["q", "Enter"], blocked)!;
  assert.notEqual(after, null, "改过了不该直接退");
  assert.match(vimView(after).status, /E37: No write since last change/);

  assert.equal(press(["q", "!", "Enter"], vimKey(dirty, ":") as Vim), null);
});

test("认不出的 : 命令照实报，不静默吞掉", () => {
  assert.match(vimView(press([":", "z", "z", "z", "Enter"])!).status, /E492: Not an editor command: zzz/);
});

test("insertText 一次插一整串 —— 输入法合成完走这条路", () => {
  const v = insertText(vimKey(open(), "i") as Vim, "你好世界");
  assert.equal(v.lines[0], "你好世界alpha");
  assert.equal(v.col, 4, "按字符数不是码元数");
});

test("文件比屏幕长时视口跟着光标走", () => {
  const long = openVim(Array.from({ length: 40 }, (_, i) => `L${i + 1}`).join("\n"), "l", 10);
  const bottom = press(["G"], long)!;
  assert.ok(bottom.top > 0, "光标到底部，视口必须跟过去");
  assert.ok(vimView(bottom).body.includes("L40"), "最后一行要在视口里");
  assert.equal(vimView(press(["g", "g"], bottom)!).body[0], "L1");
});

test("文件末尾之后用 ~ 填，和真 vim 一样", () => {
  assert.equal(vimView(open()).body.filter((l) => l === "~").length, 6, "3 行内容 + 6 个 ~ = 9");
});

test("没装的时候 vim 不存在，装了才有", async () => {
  const bare = await execute("vim a.txt", ctxOf(ROOT, at()));
  assert.match(bare.error!, /Command 'vim' not found/);
  assert.match(bare.error!, /sudo apt install vim/);
});

test("vim 命令把内容交给 ctx.edit，不自己打印", async () => {
  const edited: { text: string; name: string }[] = [];
  // vim 是 apt 装的，没装的时候命令根本不存在
  const ctx = ctxOf(ROOT, at(), [], "zh", new Map([["vim", "9.1"]]), undefined, [], [], undefined, [], edited);

  const r = await execute("vim a.txt", ctx);
  assert.equal(r.error, undefined, `意外报错: ${r.error}`);
  assert.equal(r.output, undefined, "vim 接管屏幕，不产生行输出");
  assert.deepEqual(edited, [{ text: "alpha\nbeta\nGamma", name: "a.txt" }]);

  // 不给文件就是空缓冲区
  edited.length = 0;
  await execute("vim", ctx);
  assert.deepEqual(edited, [{ text: "", name: "[No Name]" }]);
});

function pos(v: Vim): [number, number] {
  return [v.row, v.col];
}
