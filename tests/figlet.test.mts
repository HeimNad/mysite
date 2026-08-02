// FIGfont 渲染器。期望值是拿官方 figlet 实现（npm figlet 1.11.4，Standard 字体）
// 跑出来的，不是我手敲的 —— 手敲的期望值只能证明代码没变，证明不了它是对的。
//
// 三个用例覆盖三种融合规则：
//   heimnad  下划线和 | 融合（规则 2），小写字母密排
//   ls | wc  硬空格（| 那一列靠它撑开，否则会塌进旁边的字母）
//   AVWX     斜杠对撞（规则 3 等级），最容易因为多叠一列而糊掉
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFont, renderFiglet, type Font } from "../lib/terminal/figlet.ts";

const FONT_PATH = "public/apt/pool/universe/f/figlet/figlet_2.2.5-3.flf";

const EXPECTED: Record<string, string> = {
  heimnad:
    "  _          _                           _\n | |__   ___(_)_ __ ___  _ __   __ _  __| |\n | '_ \\ / _ \\ | '_ ` _ \\| '_ \\ / _` |/ _` |\n | | | |  __/ | | | | | | | | | (_| | (_| |\n |_| |_|\\___|_|_| |_| |_|_| |_|\\__,_|\\__,_|",
  "ls | wc":
    "  _       _\n | |___  | | __      _____\n | / __| | | \\ \\ /\\ / / __|\n | \\__ \\ | |  \\ V  V / (__\n |_|___/ | |   \\_/\\_/ \\___|\n         |_|",
  AVWX:
    "     ___     ____        ____  __\n    / \\ \\   / /\\ \\      / /\\ \\/ /\n   / _ \\ \\ / /  \\ \\ /\\ / /  \\  /\n  / ___ \\ V /    \\ V  V /   /  \\\n /_/   \\_\\_/      \\_/\\_/   /_/\\_\\",
};

/** 官方实现每行右侧留白、末尾多一空行；比较前两边都右裁 */
const norm = (s: string) =>
  s.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");

let font: Font;
async function load(): Promise<Font> {
  font ??= parseFont(await readFile(FONT_PATH, "utf8"));
  return font;
}

test("解析真实的 Standard.flf", async () => {
  const f = await load();
  assert.equal(f.height, 6);
  assert.equal(f.hardblank, "$", "硬空格是 $，渲染时才变空格");
  assert.equal(f.layout, 15, "规则 1+2+4+8");
  assert.equal(f.chars.size, 95, "ASCII 32..126 一个不少");
});

test("渲染结果和官方 figlet 一致", async () => {
  const f = await load();
  for (const [input, want] of Object.entries(EXPECTED)) {
    assert.equal(norm(renderFiglet(input, f)), want, `${JSON.stringify(input)} 渲染不对`);
  }
});

test("硬空格不会漏进输出", async () => {
  const f = await load();
  // $ 是排版占位符，出现在最终输出里说明忘了换回空格
  assert.doesNotMatch(renderFiglet("ls | wc", f), /\$/);
});

test("认不出的字符不会炸，也不会吞掉整行", async () => {
  const f = await load();
  assert.equal(renderFiglet("", f).trim(), "", "空串给空结果");
  // 中文没有字形，按空格处理，但英文部分要照常渲染出来
  const mixed = renderFiglet("a中b", f);
  assert.ok(mixed.split("\n").length === f.height, "行数必须等于字体高度");
  assert.ok(mixed.trim().length > 0, "英文部分该有内容");
});

test("坏字体文件报得出人话", () => {
  assert.throws(() => parseFont("这不是字体"), /FIGfont/);
});
