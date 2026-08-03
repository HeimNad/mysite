// 命令注册表。这个文件基本上是一张表 —— 逻辑在 command-utils.ts。
// 纯数据无 JSX、不碰 DOM，所以 node --test 能直接跑（见 shell.test.mts）
import { absPath, getNode, HOME, isDir, resolvePath, type StatDir, type StatMap } from "./fs.ts";
import { ME, OS_NAME, SHELL_NAME, VERSION } from "../site/me.ts";
import { LANGS, pick, type Lang, type Msg } from "../site/i18n.ts";
import { displayWidth, padCols } from "./text.ts";
import { aptSize, PACKAGES } from "./packages.ts";
import { getFont, renderFiglet } from "./figlet.ts";
import { INIT_PID, psTable, type Proc } from "./procs.ts";
import { dfTable, freeTable, unameLine, type Machine } from "./procfs.ts";
import { formatWeather, parseWttr } from "./weather.ts";
import { SITE_URL } from "../site/me.ts";
import {
  entries,
  fsUsage,
  homeFile,
  humanSize,
  longLine,
  loginDate,
  readInput,
  takeNum,
  treeLines,
} from "./command-utils.ts";

/**
 * 需要图形化渲染的输出，由 UI 层认领。
 * 文字在这里算好（所以双语和"防漏译"测试都覆盖得到），UI 只负责摆字符画
 */
export type Visual =
  | { render: "neofetch"; info: string[] }
  | { render: "sl" }
  | { render: "donut" };

/** 文章元数据。故意不含 body —— 正文按需从 /api/fs 取，别传两份 */
export type PostMeta = {
  slug: string;
  title: string;
  date: string;
  lang: Lang;
  tags: string[];
};

/**
 * 命令能做的一切副作用都从这里走 —— 这个文件保持纯逻辑，不碰 window/document，
 * 所以 node --test 能直接跑它，UI 层怎么实现这些回调与逻辑无关
 */
export type Ctx = {
  /** 只有目录结构，文件内容不在里面 */
  root: StatDir;
  cwd: string[];
  setCwd: (segs: string[]) => void;
  clear: () => void;
  openUrl: (url: string) => void;
  toggleTheme: () => void;
  /** 按需取文件内容（客户端走 fetch + 缓存）。路径必须已确认是文件 */
  read: (segs: string[]) => Promise<string>;
  /** 取一个地址的响应体，curl 和 wttr 用。站内路径或 http(s) 绝对地址；非 2xx 会抛 */
  http: (url: string) => Promise<string>;
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** 就地选译文：ctx.t("中文", "English") */
  t: (zh: string, en: string) => string;
  history: string[];
  posts: PostMeta[];
  /** ls -l 的大小和时间，键是绝对路径去掉开头的 / */
  stats: StatMap;
  /** 真 ls 的行为取决于输出是不是管道，我们照抄 */
  piped: boolean;
  /** 已装的包 → 它的内容。带 pkg 的命令要装了才查得到 */
  pkgs: Map<string, string>;
  /** 真去下载一个包，返回真实的字节数和耗时 —— apt 的输出不编数字 */
  install: (name: string) => Promise<{ bytes: number; ms: number }>;
  /** 只有 sudo 转交过来的时候才是 true */
  asRoot: boolean;
  /** 这台机器上真在跑的东西 —— 动画的定时器，不是编的列表 */
  procs: Proc[];
  /** 真的停掉那个定时器 */
  kill: (pid: number) => void;
  /** 单调时钟，ELAPSED 用。浏览器和 Node 都有 performance，属于跨运行时 */
  now: () => number;
  /** 内核 panic：整个终端崩掉，交给 error.tsx */
  panic: (message: string) => void;
  /** 访客自己机器的真实参数。拿不到的字段是 null，不是编的默认值 */
  machine: () => Promise<Machine>;
  /** 把文本交给分页器。键盘从此归 less，直到用户按 q */
  page: (text: string, name: string) => void;
};

/**
 * 命令别名。和真 shell 一样在查命令之前展开，只认第一个词。
 * 想加就往这里加一行，help 和 Tab 补全会自己带上
 */
export const ALIASES: Record<string, string> = {
  ll: "ls -l",
  la: "ls -la",
  l: "ls",
  ".": "pwd",
  h: "history",
  cls: "clear",
};

export type Cmd = {
  desc: Msg;
  usage?: Msg;
  /** man 的 DESCRIPTION 段；缺省则用 desc */
  man?: Msg;
  /** 彩蛋：不出现在 help 和 Tab 补全里 */
  hidden?: boolean;
  /** 属于某个包：装了才查得到，也才出现在 help 和 Tab 补全里 */
  pkg?: string;
  /** 返回 string 才能进管道；Visual 只能是最后一环；void 表示无输出。
   *  要读文件内容的命令返回 Promise —— 只看结构的（ls/cd/tree…）保持同步 */
  run: (
    args: string[],
    stdin: string | null,
    ctx: Ctx
  ) => string | Visual | void | Promise<string | Visual | void>;
};

export const COMMANDS: Record<string, Cmd> = {
  help: {
    desc: { zh: "显示本帮助", en: "show this help" },
    run(_args, _stdin, ctx) {
      const cmds = Object.entries(COMMANDS)
        .filter(([, c]) => !c.hidden && available(c, ctx.pkgs))
        .sort(([a], [b]) => a.localeCompare(b));
      const w = Math.max(...cmds.map(([n]) => n.length));
      return [
        ctx.t(
          "可用命令（man <命令> 看详细用法）:",
          "Available commands (man <command> for details):"
        ),
        ...cmds.map(([n, c]) => `  ${n.padEnd(w)}  ${pick(c.desc, ctx.lang)}`),
        "",
        ctx.t(
          "管道: cat skills.txt | grep Language | wc -l",
          "Pipes: cat skills.txt | grep Language | wc -l"
        ),
        ctx.t(
          "Tab 补全，↑↓ 翻历史，Ctrl+L 清屏。文件系统里藏了点东西。",
          "Tab completes, ↑↓ walks history, Ctrl+L clears. The filesystem hides a few things."
        ),
      ].join("\n");
    },
  },

  man: {
    desc: { zh: "查看命令手册", en: "display a command's manual page" },
    usage: { zh: "man <命令>", en: "man <command>" },
    run(args, _stdin, ctx) {
      const name = args[0];
      if (!name)
        throw new Error(
          ctx.t("你想读哪一页？用法: man <命令>", "What manual page do you want? Usage: man <command>")
        );
      // hasOwn：man constructor 走原型链会取到 Object 构造函数，然后读 desc.zh 炸掉
      const cmd = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
      if (!cmd) throw new Error(ctx.t(`没有 ${name} 的手册页`, `No manual entry for ${name}`));
      return [
        "NAME",
        `    ${name} - ${pick(cmd.desc, ctx.lang)}`,
        "",
        "SYNOPSIS",
        `    ${cmd.usage ? pick(cmd.usage, ctx.lang) : name}`,
        "",
        "DESCRIPTION",
        ...pick(cmd.man ?? cmd.desc, ctx.lang)
          .split("\n")
          .map((l) => "    " + l),
      ].join("\n");
    },
  },

  lang: {
    desc: { zh: "切换语言 (zh/en)", en: "switch language (zh/en)" },
    usage: { zh: "lang [zh|en]", en: "lang [zh|en]" },
    man: {
      zh: "不带参数显示当前语言。\n首次访问按浏览器语言选择，之后记住。\n只影响系统提示，文章不翻译。",
      en: "With no argument, prints the current language.\nThe first visit follows your browser; after that the choice is remembered.\nAffects system messages only; articles are not translated.",
    },
    run(args, _stdin, ctx) {
      const want = args[0];
      if (!want)
        return ctx.t(
          `当前语言: ${ctx.lang}。可选: ${LANGS.join(" ")}。用 lang en 切换。`,
          `Current language: ${ctx.lang}. Available: ${LANGS.join(" ")}. Use "lang zh" to switch.`
        );
      if (!LANGS.includes(want as Lang))
        throw new Error(
          ctx.t(
            `lang: 不支持 ${want}。可选: ${LANGS.join(" ")}`,
            `lang: unsupported locale ${want}. Available: ${LANGS.join(" ")}`
          )
        );
      const next = want as Lang;
      ctx.setLang(next);
      // 用目标语言回话，切换才有确认感
      return next === "zh" ? "语言已切换为中文。" : "Language switched to English.";
    },
  },

  ls: {
    desc: { zh: "列出目录内容", en: "list directory contents" },
    usage: { zh: "ls [-al] [路径...]", en: "ls [-al] [path...]" },
    man: {
      zh: "默认隐藏以 . 开头的文件。-a 全部列出，-l 长格式。\n输出接管道时一行一个。\n文件系统只读，所以没有 w 位。",
      en: "Hides dotfiles by default. -a lists everything, -l uses the long format.\nOne entry per line when the output is a pipe.\nThe filesystem is read-only, so nothing carries a w bit.",
    },
    run(args, _stdin, ctx) {
      // 只认短 flag，-al / -la 这种组合照样认。以前是把所有 - 开头的拼起来找 a 和 l，
      // 于是 --all 里那两个字母都被当成 flag，ls --all 会连长格式一起打开
      const opts = args.filter((a) => a.startsWith("-"));
      const bad = opts.find((o) => !/^-[al]+$/.test(o));
      if (bad)
        throw new Error(
          ctx.t(`ls: 无法识别的选项 '${bad}'`, `ls: unrecognized option '${bad}'`)
        );
      const flags = opts.join("");
      const showAll = flags.includes("a");
      const long = flags.includes("l");
      const paths = args.filter((a) => !a.startsWith("-"));
      const targets: (string | undefined)[] = paths.length ? paths : [undefined];
      return targets
        .map((p) => {
          const segs = resolvePath(ctx.cwd, p);
          const node = getNode(ctx.root, segs);
          if (node === undefined)
            throw new Error(
              ctx.t(
                `ls: 无法访问 '${p}': 没有那个文件或目录`,
                `ls: cannot access '${p}': No such file or directory`
              )
            );
          // 参数是文件时 -l 一样要给长格式，真 ls 就是这样
          if (!isDir(node))
            return long ? longLine(p!, node, ctx.stats[segs.join("/")]) : p!;
          const names = entries(node, showAll);
          const listed = names.map((n) => n + (isDir(node[n]) ? "/" : ""));
          const body = long
            ? [
                `total ${names.length}`,
                ...names.map((n) => longLine(n, node[n], ctx.stats[[...segs, n].join("/")])),
              ].join("\n")
            : listed.join(ctx.piped ? "\n" : "  ");
          return targets.length > 1 ? `${p}:\n${body}` : body;
        })
        .join("\n\n");
    },
  },

  motd: {
    desc: { zh: "显示登录横幅", en: "print the login banner" },
    man: {
      zh: "登录时打印的那段。随时可以再看一次。",
      en: "The block printed at login. Run it again whenever you like.",
    },
    run(_args, _stdin, ctx) {
      const { files, bytes } = fsUsage(ctx.root, ctx.stats);
      const aliases = Object.keys(ALIASES).length;
      const cmds = Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden).length;

      // 两列排版。标签一律英文 —— 和 neofetch 一个道理，没人把 Uptime 叫"运行"
      const row = (a: string, av: string, b: string, bv: string) =>
        "  " + padCols(a, 14) + padCols(av, 24) + padCols(b, 14) + bv;

      return [
        ctx.t(
          `欢迎来到 ${OS_NAME} ${VERSION}`,
          `Welcome to ${OS_NAME} ${VERSION}`
        ),
        "",
        ` * Manual:   man <${ctx.t("命令", "command")}>`,
        ` * Articles: posts`,
        ` * Contact:  contact`,
        ` * Source:   ${ME.repo}`,
        "",
        `  System information as of ${loginDate(new Date())}`,
        "",
        // 不放 Uptime —— 登录时它永远是 0，什么也没说。想看去敲 neofetch
        row("Filesystem:", `${humanSize(bytes)} in ${files} files`, "Articles:", String(ctx.posts.length)),
        row("Commands:", `${cmds} (+${aliases} aliases)`, "Locale:", ctx.lang),
        "",
        ctx.t("help 看能做什么，neofetch 看我长什么样。", "help lists what works. neofetch shows my face."),
      ].join("\n");
    },
  },

  alias: {
    desc: { zh: "显示命令别名", en: "show command aliases" },
    man: {
      zh: "别名在查命令之前展开，只作用于第一个词。ll 执行的是 ls -l。",
      en: "Aliases expand before the command is looked up, and only on the first word. ll runs ls -l.",
    },
    run: () =>
      Object.entries(ALIASES)
        .map(([k, v]) => `alias ${k}='${v}'`)
        .join("\n"),
  },

  cd: {
    desc: { zh: "切换当前目录", en: "change the working directory" },
    usage: { zh: "cd [路径]", en: "cd [path]" },
    man: {
      zh: `不带参数回到 ~（/home/${ME.user}）。支持 .. 和绝对路径。`,
      en: `With no argument, returns to ~ (/home/${ME.user}). Understands .. and absolute paths.`,
    },
    run(args, _stdin, ctx) {
      const segs = args[0] ? resolvePath(ctx.cwd, args[0]) : [...HOME];
      const node = getNode(ctx.root, segs);
      if (node === undefined)
        throw new Error(
          ctx.t(`cd: ${args[0]}: 没有那个文件或目录`, `cd: ${args[0]}: No such file or directory`)
        );
      if (!isDir(node))
        throw new Error(ctx.t(`cd: ${args[0]}: 不是目录`, `cd: ${args[0]}: Not a directory`));
      ctx.setCwd(segs);
    },
  },

  pwd: {
    desc: { zh: "显示当前目录", en: "print the working directory" },
    run: (_a, _s, ctx) => absPath(ctx.cwd),
  },

  cat: {
    desc: { zh: "查看文件内容", en: "concatenate files and print" },
    usage: { zh: "cat [文件...]", en: "cat [file...]" },
    man: {
      zh: "输出文件内容。没给文件名就读标准输入。",
      en: "Prints file contents. With no file, reads standard input.",
    },
    run: (args, stdin, ctx) => readInput(args, stdin, ctx, "cat"),
  },

  less: {
    desc: { zh: "分页查看", en: "page through text" },
    usage: { zh: "less [文件]", en: "less [file]" },
    man: {
      zh:
        "一屏一屏地看，长文不会一次糊出来。没给文件就读标准输入，\n" +
        "所以 cat posts/xxx.md | less 和 man ls | less 都成立。\n" +
        "\n" +
        "  空格 / f       下一屏          b       上一屏\n" +
        "  j / ↓          下一行          k / ↑   上一行\n" +
        "  d / u          翻半屏          g / G   开头 / 结尾\n" +
        "  /              搜索            n / N   下一个 / 上一个\n" +
        "  q              退出\n" +
        "\n" +
        "less 开着的时候键盘归它，q 才还给提示符 —— 和真终端一样。\n"
        + "搜索支持中文：/ 之后按键交回输入框，输入法照常合成。",
      en:
        "One screenful at a time, so long files stop flooding the screen.\n" +
        "With no file it reads standard input, so cat posts/x.md | less works,\n" +
        "and so does man ls | less.\n" +
        "\n" +
        "  Space / f      next screen     b       previous screen\n" +
        "  j / Down       next line       k / Up  previous line\n" +
        "  d / u          half screen     g / G   start / end\n" +
        "  /              search          n / N   next / previous match\n" +
        "  q              quit\n" +
        "\n" +
        "While less is open the keyboard belongs to it; q gives it back.\n"
        + "Search accepts CJK: after / the keys go back to the input, so an IME composes normally.",
    },
    async run(args, stdin, ctx) {
      const text = await readInput(args, stdin, ctx, "less");
      const file = args.find((a) => !a.startsWith("-"));
      ctx.page(text, file ?? "(stdin)");
    },
  },

  tree: {
    desc: { zh: "树状列出当前目录", en: "list the current directory as a tree" },
    usage: { zh: "tree [-a] [路径]", en: "tree [-a] [path]" },
    man: {
      zh: "从当前目录往下画。tree / 是整棵。",
      en: "Draws downward from the current directory. tree / covers the whole thing.",
    },
    run(args, _stdin, ctx) {
      const path = args.find((a) => !a.startsWith("-"));
      const segs = resolvePath(ctx.cwd, path);
      const node = getNode(ctx.root, segs);
      if (node === undefined)
        throw new Error(
          ctx.t(`tree: ${path}: 没有那个文件或目录`, `tree: ${path}: No such file or directory`)
        );
      if (!isDir(node))
        throw new Error(ctx.t(`tree: ${path}: 不是目录`, `tree: ${path}: Not a directory`));
      return [absPath(segs), ...treeLines(node, args.includes("-a"))].join("\n");
    },
  },

  grep: {
    desc: { zh: "按模式筛选行", en: "print lines matching a pattern" },
    usage: { zh: "grep [-i] <模式> [文件...]", en: "grep [-i] <pattern> [file...]" },
    man: {
      zh: "输出匹配的行。-i 忽略大小写。没给文件名就读标准输入。\n模式按正则处理，非法正则按普通文本匹配。",
      en: "Prints matching lines. -i ignores case. With no file, reads standard input.\nThe pattern is a regex; an invalid one is matched as plain text.",
    },
    async run(args, stdin, ctx) {
      const ignoreCase = args.includes("-i");
      const rest = args.filter((a) => !a.startsWith("-"));
      const pattern = rest[0];
      if (!pattern)
        throw new Error(
          ctx.t(
            "grep: 用法: grep [-i] <模式> [文件...]",
            "grep: usage: grep [-i] <pattern> [file...]"
          )
        );
      const lines = (await readInput(rest.slice(1), stdin, ctx, "grep")).split("\n");
      let match: (line: string) => boolean;
      try {
        const re = new RegExp(pattern, ignoreCase ? "i" : "");
        match = (l) => re.test(l);
      } catch {
        // 非法正则退化成纯文本匹配，别让访客看见 SyntaxError
        const needle = ignoreCase ? pattern.toLowerCase() : pattern;
        match = (l) => (ignoreCase ? l.toLowerCase() : l).includes(needle);
      }
      return lines.filter(match).join("\n");
    },
  },

  wc: {
    desc: { zh: "统计行数/词数/字符数", en: "count lines, words and characters" },
    usage: { zh: "wc [-l|-w|-c] [文件...]", en: "wc [-l|-w|-c] [file...]" },
    man: {
      zh: "不带选项时依次输出行数、词数、字符数。",
      en: "With no option, print lines, words and characters in that order.",
    },
    async run(args, stdin, ctx) {
      const text = await readInput(args, stdin, ctx, "wc");
      const counts = {
        "-l": text === "" ? 0 : text.split("\n").length,
        "-w": text.split(/\s+/).filter(Boolean).length,
        "-c": text.length,
      };
      const picked = (["-l", "-w", "-c"] as const).filter((f) => args.includes(f));
      const show = picked.length ? picked : (["-l", "-w", "-c"] as const);
      return show.map((f) => String(counts[f]).padStart(6)).join("");
    },
  },

  head: {
    desc: { zh: "显示开头若干行", en: "output the first lines of a file" },
    usage: { zh: "head [-n 行数] [文件...]", en: "head [-n count] [file...]" },
    man: {
      zh: "默认 10 行。-n 5 和 -5 都认。",
      en: "Defaults to 10 lines. Both -n 5 and -5 are accepted.",
    },
    async run(args, stdin, ctx) {
      const { n, rest } = takeNum(args, 10);
      const lines = (await readInput(rest, stdin, ctx, "head")).split("\n");
      return lines.slice(0, n).join("\n");
    },
  },

  tail: {
    desc: { zh: "显示末尾若干行", en: "output the last lines of a file" },
    usage: { zh: "tail [-n 行数] [文件...]", en: "tail [-n count] [file...]" },
    man: {
      zh: "默认 10 行。-n 5 和 -5 都认。",
      en: "Defaults to 10 lines. Both -n 5 and -5 are accepted.",
    },
    async run(args, stdin, ctx) {
      const { n, rest } = takeNum(args, 10);
      const lines = (await readInput(rest, stdin, ctx, "tail")).split("\n");
      return n <= 0 ? "" : lines.slice(-n).join("\n"); // slice(-0) 会返回全部，得挡一下
    },
  },

  posts: {
    desc: { zh: "列出所有文章", en: "list all articles" },
    usage: { zh: "posts [标签]", en: "posts [tag]" },
    man: {
      zh: "列出文章的标题、日期和标签，按时间倒序。\n给一个标签就只列带那个标签的。\nopen posts/<文件> 打开渲染版。",
      en: "Lists article titles, dates and tags, newest first.\nPass a tag to list only the articles carrying it.\nopen posts/<file> for the rendered version.",
    },
    run(args, _stdin, ctx) {
      if (!ctx.posts.length)
        return ctx.t(
          "还没有文章。往 content/posts/ 里丢一个 .md 就有了。",
          "No articles yet. Drop a .md into content/posts/ and one appears."
        );

      const wanted = args[0]?.toLowerCase();
      const shown = wanted
        ? ctx.posts.filter((p) => p.tags.some((t) => t.toLowerCase() === wanted))
        : ctx.posts;

      if (!shown.length) {
        const all = [...new Set(ctx.posts.flatMap((p) => p.tags))].sort();
        throw new Error(
          ctx.t(
            `posts: 没有标签为 ${args[0]} 的文章。` +
              (all.length ? `现有标签: ${all.join(" ")}` : "还没有任何标签。"),
            `posts: no articles tagged ${args[0]}. ` +
              (all.length ? `Tags in use: ${all.join(" ")}` : "No tags are in use yet.")
          )
        );
      }

      const dateW = Math.max(...shown.map((p) => p.date.length));
      // 标题按显示列数补齐，中文标题后面的列才对得齐
      const titleW = Math.max(...shown.map((p) => displayWidth(p.title)));
      const rows = shown.map((p) => {
        // 路径要留着 —— 那是你接下来要 cat 或 open 的东西
        const head = `${p.date.padEnd(dateW)}  ${padCols(p.title, titleW)}  (posts/${p.slug}.md)`;
        // 文章语言和界面语言不一致时标出来，免得点进去发现读不懂
        const lang = p.lang !== ctx.lang ? `  <${p.lang}>` : "";
        const tags = p.tags.length ? `  [${p.tags.join(" ")}]` : "";
        return head + lang + tags;
      });

      return [
        ...rows,
        "",
        ctx.t("open posts/<文件> 打开渲染版。", "open posts/<file> for the rendered version."),
      ].join("\n");
    },
  },

  open: {
    desc: { zh: "在浏览器里打开文章的渲染版", en: "open an article's rendered page in a new tab" },
    usage: { zh: "open posts/<文章>.md", en: "open posts/<article>.md" },
    man: {
      zh: "在新标签打开文章的渲染版。cat 给的是 markdown 源码。\n只有 posts/ 下的 .md 有渲染版。",
      en: "Opens an article's rendered page in a new tab. cat gives you the markdown source.\nOnly .md files under posts/ have one.",
    },
    run(args, _stdin, ctx) {
      if (!args[0])
        throw new Error(
          ctx.t("open: 用法: open posts/<文章>.md", "open: usage: open posts/<article>.md")
        );
      const segs = resolvePath(ctx.cwd, args[0]);
      const node = getNode(ctx.root, segs);
      if (node === undefined)
        throw new Error(
          ctx.t(`open: ${args[0]}: 没有那个文件或目录`, `open: ${args[0]}: No such file or directory`)
        );
      const inPostsDir =
        segs.length === HOME.length + 2 &&
        [...HOME, "posts"].every((s, i) => segs[i] === s) &&
        segs[segs.length - 1].endsWith(".md");
      if (!inPostsDir)
        throw new Error(
          ctx.t(
            `open: ${args[0]}: 只有 ~/posts/ 里的文章有渲染页`,
            `open: ${args[0]}: only articles under ~/posts/ have a rendered page`
          )
        );
      const url = `/posts/${segs[segs.length - 1].replace(/\.md$/, "")}`;
      ctx.openUrl(url);
      return ctx.t(`已在新标签打开 ${url}`, `Opened ${url} in a new tab`);
    },
  },

  curl: {
    desc: { zh: "取一个 URL 的内容", en: "transfer data from a URL" },
    usage: { zh: "curl <路径>", en: "curl <path>" },
    man: {
      zh:
        "本站的接口：\n" +
        "  curl /api/me                     我的信息\n" +
        "  curl /api/posts                  文章列表\n" +
        "  curl /api/fs/<路径>              任意一个文件\n" +
        "  curl /feed.xml                   RSS\n" +
        "\n" +
        "外站也真的会去请求，但读不读得到不由这台机器决定：浏览器只允许读\n" +
        "那些明确发了 Access-Control-Allow-Origin 的站点。所以\n" +
        "  curl https://wttr.in/tokyo?format=j1     能读（对方放行了）\n" +
        "  curl https://example.com                 读不到（对方没放行）\n" +
        "失败时浏览器不会告诉脚本具体原因，只知道请求没能完成。\n" +
        "输出可以进管道。",
      en:
        "This site's own endpoints:\n" +
        "  curl /api/me                     who I am\n" +
        "  curl /api/posts                  the article list\n" +
        "  curl /api/fs/<path>              any file\n" +
        "  curl /feed.xml                   the RSS feed\n" +
        "\n" +
        "Outside hosts are really requested, but whether the response can be read\n" +
        "is not this machine's call: a browser only lets a page read hosts that\n" +
        "send Access-Control-Allow-Origin. So\n" +
        "  curl https://wttr.in/tokyo?format=j1     works (that host allows it)\n" +
        "  curl https://example.com                 does not (it doesn't)\n" +
        "On failure the browser never tells a script why — only that it failed.\n" +
        "The output pipes.",
    },
    run(args, _stdin, ctx) {
      const target = args.find((a) => !a.startsWith("-"));
      if (!target)
        throw new Error(ctx.t("curl: 用法: curl <地址>", "curl: usage: curl <url>"));
      // 只认 http(s) 和站内绝对路径。file:// 之类浏览器本来也会拒，早点说清楚
      if (!/^https?:\/\//i.test(target) && !target.startsWith("/"))
        throw new Error(`curl: (3) URL rejected: Bad hostname`);
      return ctx.http(target);
    },
  },

  wttr: {
    desc: { zh: "查天气", en: "check the weather" },
    usage: { zh: "wttr [城市]", en: "wttr [city]" },
    man: {
      zh:
        "不给城市就按你的 IP 定位。\n" +
        "\n" +
        "这是本站唯一一条会往站外发请求的命令 —— 它去 wttr.in 取数据，\n" +
        "所以你的 IP 会被那台服务器看到。不想被看到就别敲，或者给一个城市名。\n" +
        "\n" +
        "取回来的是 JSON，排版是这台机器自己做的：wttr.in 的字符画只发给\n" +
        "curl 那类客户端，浏览器去要会得到一整页 HTML。",
      en:
        "With no city, wttr.in locates you by IP.\n" +
        "\n" +
        "This is the only command here that talks to anything outside this site.\n" +
        "It fetches from wttr.in, so that server sees your IP. Pass a city name\n" +
        "if you would rather it didn't, or skip the command.\n" +
        "\n" +
        "The JSON comes from wttr.in; the layout is this machine's own, because\n" +
        "wttr.in only serves its ASCII art to curl-like clients — a browser asking\n" +
        "for it gets a full HTML page.",
    },
    async run(args, _stdin, ctx) {
      const city = args.filter((a) => !a.startsWith("-")).join(" ");
      const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
      let body: string;
      try {
        body = await ctx.http(url);
      } catch {
        throw new Error(
          ctx.t(
            `wttr: 没能拿到 ${city || "你所在位置"} 的天气。地名写错了，或者 wttr.in 这会儿不通。`,
            `wttr: could not get the weather for ${city || "your location"}. Bad place name, or wttr.in is down.`
          )
        );
      }
      try {
        return formatWeather(parseWttr(body), ctx.t, city === "");
      } catch (e) {
        // 地名查不到时 wttr 回的是一行纯文本，原样转达比自己编好
        throw new Error(`wttr: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  },

  neofetch: {
    desc: { zh: "显示系统信息和头像", en: "show system info and avatar" },
    run(_args, _stdin, ctx): Visual {
      const uptime = Math.floor(performance.now() / 1000);
      // 字段名保持 neofetch 原本的英文 —— 中国开发者的终端里也没人把 Shell 叫"外壳"。
      // 界面动词用英文、叙述用中文，本来就是真实终端的样子。只有值跟着语言走
      const pad = (label: string) => label.padEnd(10);
      return {
        render: "neofetch",
        info: [
          `${ME.user}@${ME.host}`,
          "─".repeat(ME.user.length + ME.host.length + 1),
          pad("OS:") + `${OS_NAME} ${VERSION} ` + ctx.t("(浏览器里的假 Linux)", "(a fake Linux in a browser tab)"),
          pad("Host:") + `${ME.name} — ${pick(ME.title, ctx.lang)}`,
          pad("Shell:") + `${SHELL_NAME} ${VERSION}`,
          pad("Uptime:") + `${uptime}s`,
          pad("Locale:") + `${ctx.lang} ${ctx.t("(lang en 切英文)", "(lang zh for Chinese)")}`,
          pad("Email:") + ME.email,
          pad("GitHub:") + ME.github,
        ],
      };
    },
  },

  // 这两个从家目录读，不管当前 cwd 在哪
  about: {
    desc: { zh: "关于我", en: "about me" },
    run: (_a, _s, ctx) => homeFile(ctx, "about.txt"),
  },
  contact: {
    desc: { zh: "联系方式", en: "how to reach me" },
    run: (_a, _s, ctx) => homeFile(ctx, "contact.txt"),
  },
  whoami: {
    desc: { zh: "显示当前用户", en: "print the current user" },
    run: () => ME.user,
  },
  date: {
    desc: { zh: "显示当前时间", en: "print the current date and time" },
    run: () => new Date().toString(),
  },
  echo: {
    desc: { zh: "回显文本", en: "write arguments to standard output" },
    usage: { zh: "echo <文本...>", en: "echo <text...>" },
    run: (args) => args.join(" "),
  },

  history: {
    desc: { zh: "显示命令历史", en: "show command history" },
    run: (_a, _s, ctx) => ctx.history.map((h, i) => `  ${i + 1}  ${h}`).join("\n"),
  },

  theme: {
    desc: { zh: "切换配色（绿/琥珀）", en: "toggle the color scheme (green/amber)" },
    run: (_a, _s, ctx) => {
      ctx.toggleTheme();
      return ctx.t("主题已切换。", "Theme switched.");
    },
  },

  clear: {
    desc: { zh: "清屏（等同 Ctrl+L）", en: "clear the screen (same as Ctrl+L)" },
    run: (_a, _s, ctx) => ctx.clear(),
  },

  uname: {
    desc: { zh: "显示系统信息", en: "print system information" },
    usage: { zh: "uname [-a]", en: "uname [-a]" },
    man: {
      zh: "版本号是这份代码的 commit hash，不是编的。",
      en: "The version is this code's commit hash, not a made-up number.",
    },
    async run(args, _stdin, ctx) {
      return unameLine(await ctx.machine(), args.includes("-a"));
    },
  },

  free: {
    desc: { zh: "显示内存用量", en: "show memory usage" },
    man: {
      zh:
        "Mem 来自 navigator.deviceMemory，Heap 来自 performance.memory。\n" +
        "这两个只有 Chromium 系的浏览器肯说，Safari 上会是 null ——\n" +
        "写 null 而不是填一个看着合理的数字，因为后者是编的。",
      en:
        "Mem comes from navigator.deviceMemory, Heap from performance.memory.\n" +
        "Only Chromium-based browsers report either, so Safari shows null.\n" +
        "Null rather than a plausible-looking number, because that would be invented.",
    },
    run: async (_a, _s, ctx) => freeTable(await ctx.machine()),
  },

  df: {
    desc: { zh: "显示磁盘用量", en: "report filesystem disk space usage" },
    usage: { zh: "df [-h]", en: "df [-h]" },
    man: {
      zh:
        "这台机器只有一块盘：浏览器分给本站的存储配额。\n" +
        "命令历史、语言、主题和装过的包都在上面，所以 Used 会随你的使用变。\n" +
        "配额各家不同 —— 实测 Chrome 3 G、Safari 1 G。",
      en:
        "This machine has one disk: the storage quota the browser grants this site.\n" +
        "Command history, language, theme and installed packages live on it, so Used moves.\n" +
        "The quota differs by browser — measured 3 G on Chrome, 1 G on Safari.",
    },
    run: async (_a, _s, ctx) => dfTable(await ctx.machine(), absPath(HOME)),
  },

  ps: {
    desc: { zh: "列出正在运行的进程", en: "list running processes" },
    man: {
      zh:
        "这台机器上真在跑的东西：1 号是 shell 自己，其余是动画的定时器。\n" +
        "敲 sl 或 donut 之后再看一次，它们会出现在这里 —— 然后可以 kill 掉。\n" +
        "ELAPSED 是真实运行时长；不显示 TIME，因为 CPU 时间在浏览器里量不到。",
      en:
        "What is actually running here: PID 1 is the shell itself, the rest are\n" +
        "animation timers. Run sl or donut and look again — they show up, and\n" +
        "they can be killed.\n" +
        "ELAPSED is real. TIME is absent because CPU time is not measurable here.",
    },
    run: (_a, _s, ctx) => psTable(ctx.procs, ctx.now()),
  },

  kill: {
    desc: { zh: "终止一个进程", en: "terminate a process" },
    usage: { zh: "kill [-9] <pid>", en: "kill [-9] <pid>" },
    man: {
      zh:
        "真的把那个定时器停掉 —— 火车会当场停住，圆环会停止旋转。\n" +
        "1 号进程杀不掉，除非 -9。那样的话后果自负。",
      en:
        "Really stops that timer — the train halts, the torus stops turning.\n" +
        "PID 1 refuses to die unless you insist with -9. That goes how you would expect.",
    },
    run(args, _stdin, ctx) {
      const force = args.includes("-9");
      const target = args.find((a) => !a.startsWith("-"));
      if (!target) throw new Error(ctx.t("kill: 用法: kill [-9] <pid>", "kill: usage: kill [-9] <pid>"));

      const pid = Number(target);
      if (!Number.isInteger(pid))
        throw new Error(`kill: ${target}: ${ctx.t("参数必须是进程号", "arguments must be process IDs")}`);

      // 真 Linux 里 init 杀不掉；硬来的话内核会 panic，那就照做
      if (pid === INIT_PID) {
        if (!force) throw new Error(`kill: (${pid}) - ${ctx.t("不允许的操作", "Operation not permitted")}`);
        ctx.panic("Kernel panic - not syncing: Attempted to kill init!");
        return;
      }

      if (!ctx.procs.some((p) => p.pid === pid))
        throw new Error(`kill: (${pid}) - ${ctx.t("没有那个进程", "No such process")}`);
      ctx.kill(pid);
    },
  },

  apt: {
    desc: { zh: "包管理器", en: "package manager" },
    usage: { zh: "apt <list|install> [包名]", en: "apt <list|install> [package]" },
    man: {
      zh:
        "装东西要 root，所以是 sudo apt install <包>。\n" +
        "装的是真文件：Get: 那一行的地址浏览器能打开，字节数是它真实的大小。\n" +
        "装完命令才会出现在 help 和 Tab 补全里。",
      en:
        "Installing needs root, so it is sudo apt install <package>.\n" +
        "The download is real: the address on the Get: line opens in a browser,\n" +
        "and the byte count is that file's actual size.\n" +
        "A package's commands appear in help and Tab completion only once it is installed.",
    },
    async run(args, _stdin, ctx) {
      const [sub, name] = args.filter((a) => !a.startsWith("-"));

      if (sub === "list") {
        return [
          "Listing... Done",
          ...Object.entries(PACKAGES).map(
            ([n, p]) =>
              `${n}/stable ${p.version} all` +
              (ctx.pkgs.has(n) ? " [installed]" : "") +
              `\n  ${pick(p.desc, ctx.lang)}`
          ),
        ].join("\n");
      }

      if (sub !== "install")
        throw new Error(
          ctx.t(
            "apt: 用法: apt <list|install> [包名]",
            "apt: usage: apt <list|install> [package]"
          )
        );

      if (!name) throw new Error("E: You must give at least one package name");
      if (!Object.hasOwn(PACKAGES, name)) throw new Error(`E: Unable to locate package ${name}`);

      // 真 apt 拿不到 dpkg 锁就是这两行。它同时也在教你下次加 sudo
      if (!ctx.asRoot)
        throw new Error(
          "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n" +
            "E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?"
        );

      const pkg = PACKAGES[name];
      if (ctx.pkgs.has(name))
        return [
          `${name} is already the newest version (${pkg.version}).`,
          "0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.",
        ].join("\n");

      const { bytes, ms } = await ctx.install(name);
      // 速率是真算的：0 毫秒时按 1 毫秒算，免得除出 Infinity
      const rate = Math.round(bytes / Math.max(ms, 1));
      const file = pkg.path.split("/").pop();

      return [
        "Reading package lists... Done",
        "Building dependency tree... Done",
        "Reading state information... Done",
        "The following NEW packages will be installed:",
        `  ${name}`,
        "0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.",
        `Need to get ${aptSize(bytes)} of archives.`,
        `After this operation, ${aptSize(pkg.installedSize)} of additional disk space will be used.`,
        `Get:1 ${SITE_URL}${pkg.path} ${name} all ${pkg.version} [${aptSize(bytes)}]`,
        `Fetched ${aptSize(bytes)} in ${(ms / 1000).toFixed(0)}s (${rate.toLocaleString("en-US")} kB/s)`,
        `Selecting previously unselected package ${name}.`,
        `Preparing to unpack .../${file} ...`,
        `Unpacking ${name} (${pkg.version}) ...`,
        `Setting up ${name} (${pkg.version}) ...`,
      ].join("\n");
    },
  },

  figlet: {
    desc: { zh: "把文本变成大号字符画", en: "make large letters out of ordinary text" },
    usage: { zh: "figlet <文本...>", en: "figlet <text...>" },
    pkg: "figlet",
    man: {
      zh: "没给文本就读标准输入，所以 whoami | figlet 是成立的。\n字体是装包时下载的那个 .flf，渲染和真 figlet 逐字符一致。",
      en: "With no text, reads standard input — so whoami | figlet works.\nThe font is the .flf downloaded at install time; output matches real figlet exactly.",
    },
    run(args, stdin, ctx) {
      const text = args.length ? args.join(" ") : (stdin ?? "").trim();
      if (!text)
        throw new Error(
          ctx.t("figlet: 给点文字（或用管道喂给它）", "figlet: give it some text (or pipe something in)")
        );
      return renderFiglet(text, getFont(ctx.pkgs.get("figlet")!));
    },
  },

  // ---------- 彩蛋 ----------
  donut: {
    desc: { zh: "转一个甜甜圈", en: "spin a donut" },
    hidden: true,
    man: {
      zh: "一个三维圆环，投影成字符。旋转、透视、明暗、遮挡都是真算的，\n没有用任何图形库。转十几秒停住。",
      en: "A three-dimensional torus projected onto characters. The rotation,\nperspective, shading and occlusion are all computed; no graphics library\nis involved. It spins for a few seconds and then holds still.",
    },
    run: (): Visual => ({ render: "donut" }),
  },

  sl: {
    desc: { zh: "一列火车经过", en: "a steam locomotive passes by" },
    hidden: true,
    man: {
      zh: "把 ls 打成 sl 的时候会看到它。没有别的用途。",
      en: "What you get for typing sl instead of ls. It has no other purpose.",
    },
    run: (): Visual => ({ render: "sl" }),
  },
  sudo: {
    desc: { zh: "以另一个用户身份执行命令", en: "execute a command as another user" },
    hidden: true,
    run(args, stdin, ctx) {
      if (args.join(" ").includes("rm -rf"))
        throw new Error(
          ctx.t("nice try. 这个网站可是我一行行写的。", "nice try. I wrote this site line by line.")
        );
      // apt 是唯一借得到 root 的命令 —— 装包本来就该要权限，其余照旧不在 sudoers 里
      const [name, ...rest] = args;
      if (name === "apt") return COMMANDS.apt.run(rest, stdin, { ...ctx, asRoot: true });
      throw new Error(
        ctx.t(
          `${ME.user} 不在 sudoers 文件中。此事将被报告。`,
          `${ME.user} is not in the sudoers file. This incident will be reported.`
        )
      );
    },
  },
  vim: {
    desc: { zh: "文本编辑器", en: "text editor" },
    hidden: true,
    run: (_a, _s, ctx) =>
      ctx.t(
        "你已进入 vim。开玩笑的 —— 但如果是真的，你现在该输 :q 了。",
        "You are now in vim. Just kidding — but if you were, you would be typing :q about now."
      ),
  },
  ":q": {
    desc: { zh: "退出 vim", en: "quit vim" },
    hidden: true,
    run: (_a, _s, ctx) => ctx.t("好孩子。", "Good. You are free."),
  },
  exit: {
    desc: { zh: "退出 shell", en: "exit the shell" },
    hidden: true,
    run: (_a, _s, ctx) =>
      ctx.t(
        "这是浏览器，关不掉的。试试 Cmd+W？(别真关啊)",
        "This is a browser. There is no exit. Try Cmd+W — actually, please don't."
      ),
  },
  rm: {
    desc: { zh: "删除文件", en: "remove files" },
    hidden: true,
    run: (_a, _s, ctx) => {
      throw new Error(
        ctx.t(
          "rm: 权限不够。这里的一切都是只读的回忆。",
          "rm: Permission denied. Everything here is a read-only memory."
        )
      );
    },
  },
};

/** 没装的包里的命令等于不存在：查不到、help 里没有、Tab 也补不出来 */
export function available(cmd: Cmd, pkgs: Map<string, string>): boolean {
  return !cmd.pkg || pkgs.has(cmd.pkg);
}

/** 补全用：非隐藏且已可用的命令名 + 别名。别名也该能 Tab 补出来，否则等于没有 */
export function visibleCommands(pkgs: Map<string, string>): string[] {
  return [
    ...Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden && available(COMMANDS[n], pkgs)),
    ...Object.keys(ALIASES),
  ].sort();
}
