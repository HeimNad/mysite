// 双语：译文完整性、lang 命令、浏览器语言探测、内容的按文件回退
import { test } from "node:test";
import assert from "node:assert/strict";
import { toFileMap } from "../lib/terminal/fs.ts";
import { execute } from "../lib/terminal/shell.ts";
import { readRootfs } from "../lib/content/content.ts";
import { ME } from "../lib/site/me.ts";
import { detectLang, type Lang } from "../lib/site/i18n.ts";
import { at, ctxOf, ROOT } from "./fixtures.mts";

test("每条命令的 desc/usage/man 都有英文，且不是照抄中文", async () => {
  const { COMMANDS } = await import("../lib/terminal/commands.ts");
  const CJK = /[一-鿿]/;
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    for (const [field, msg] of [
      ["desc", cmd.desc],
      ["usage", cmd.usage],
      ["man", cmd.man],
    ] as const) {
      if (!msg) continue;
      assert.ok(msg.zh?.length, `${name}.${field} 缺中文`);
      assert.ok(msg.en?.length, `${name}.${field} 缺英文`);
      assert.doesNotMatch(msg.en, CJK, `${name}.${field} 的英文里混着中文`);
    }
  }
});

test("neofetch: 字段名保持英文，只有值跟着语言变", async () => {
  const CJK = /[一-鿿]/;
  const info = (lang: Lang) =>
    execute("neofetch", ctxOf(ROOT, at(), [], lang)).then((r) => {
      const o = r.output;
      assert.ok(o && typeof o === "object" && o.render === "neofetch", "应该返回 neofetch 标记");
      return o.info.join("\n");
    });

  const zh = await info("zh");
  assert.match(zh, /OS:\s+FakeOS \S+ \(浏览器里的假 Linux\)/);
  assert.match(zh, /Shell:\s+hnsh \S+/);
  // 字段名不该被翻译成中文 —— 没人把 Shell 叫"外壳"
  for (const label of ["OS:", "Host:", "Shell:", "Uptime:", "Locale:"]) {
    assert.ok(zh.includes(label), `中文模式下也该用英文字段名 ${label}`);
  }
  assert.doesNotMatch(zh, /系统:|主人:|外壳:|运行:/, "字段名不该翻译");
  assert.match(zh, new RegExp(ME.title.zh), "值要跟着语言变");

  const en = await info("en");
  assert.match(en, /OS:\s+FakeOS \S+ \(a fake Linux/);
  assert.match(en, new RegExp(ME.title.en));
  assert.doesNotMatch(en, CJK, `neofetch 英文面板里混着中文:\n${en}`);
});

test("除文章外，文件系统里每个文件都带英文", async () => {
  const map = toFileMap(await readRootfs());
  const CJK = /[一-鿿]/;
  // 判定标准：含中文的文件里必须也出现 ASCII 单词（不能只有中文）
  const hasLatinSentence = (s: string) => /[A-Za-z]{3,}[^\n]*[A-Za-z]{3,}/.test(s);
  for (const [path, body] of Object.entries(map)) {
    // 文章 markdown 明确可选，不强制
    if (path.startsWith(`home/${ME.user}/posts/`)) continue;
    if (!CJK.test(body)) continue; // 本来就没中文，无需英文
    assert.ok(hasLatinSentence(body), `/${path} 只有中文，缺英文`);
  }
});

test("英文模式下报错和输出都是英文", async () => {
  const en = (cmd: string) => execute(cmd, ctxOf(ROOT, at(), [], "en"));
  const CJK = /[一-鿿]/;

  for (const c of ["nope", "cat missing.txt", "cat dir", "cd a.txt", "wc", "cat a.txt |", "rm x"]) {
    const e = (await en(c)).error;
    assert.ok(e, `${c} 应该报错`);
    assert.doesNotMatch(e!, CJK, `"${c}" 的英文报错里混着中文: ${e}`);
  }

  const help = (await en("help")).output as string;
  assert.match(help, /Available commands/);
  assert.doesNotMatch(help, CJK, "英文 help 不该有中文");
  assert.match((await en("man ls")).output as string, /list directory contents/);
});

test("lang 命令：切换、校验、用目标语言回话", async () => {
  let picked: string | null = null;
  const withSet = (lang: Lang) => ({
    ...ctxOf(ROOT, at(), [], lang),
    setLang: (l: Lang) => (picked = l),
  });

  assert.match((await execute("lang", withSet("zh"))).output as string, /当前语言: zh/);
  assert.match((await execute("lang", withSet("en"))).output as string, /Current language: en/);

  assert.equal((await execute("lang en", withSet("zh"))).output, "Language switched to English.");
  assert.equal(picked, "en", "切换要通过 ctx 汇报");
  assert.equal((await execute("lang zh", withSet("en"))).output, "语言已切换为中文。");

  assert.match((await execute("lang fr", withSet("zh"))).error!, /不支持 fr/);
  assert.match((await execute("lang fr", withSet("en"))).error!, /unsupported locale fr/);
});

test("detectLang: 只有中文浏览器给中文，认不出的给英文", async () => {
  assert.equal(detectLang(["zh-CN", "en"]), "zh");
  assert.equal(detectLang(["zh"]), "zh");
  assert.equal(detectLang(["ZH-Hant"]), "zh", "大小写不敏感");
  assert.equal(detectLang(["en-US"]), "en");
  assert.equal(detectLang(["ja", "ko"]), "en", "认不出的一律英文");
  assert.equal(detectLang([]), "en");
});

test("内容按文件自愿翻译：有 .en 就用，没有退回中文", async () => {
  const root = await readRootfs();
  const run = async (cmd: string, lang: Lang) => {
    const r = await execute(cmd, ctxOf(root, at(), [], lang));
    assert.equal(r.error, undefined, `意外报错: ${r.error}`);
    return r.output as string;
  };
  // about.en.txt 存在 → 英文下走它
  assert.match(await run("about", "en"), /university student/);
  assert.match(await run("about", "zh"), /你好/);
  // cat 是显式路径，不做语言回退 —— 想看哪个文件就是哪个文件
  assert.match(await run("cat about.txt", "en"), /你好/);
});
