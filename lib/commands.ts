// 命令注册表。这个文件基本上是一张表 —— 逻辑在 command-utils.ts。
// 纯数据无 JSX、不碰 DOM，所以 node --test 能直接跑（见 shell.test.mts）
import { absPath, getNode, HOME, isDir, resolvePath, type StatDir, type StatMap } from "./fs.ts";
import { ME } from "./me.ts";
import { LANGS, pick, type Lang, type Msg } from "./i18n.ts";
import { displayWidth, padCols } from "./text.ts";
import {
  entries,
  homeFile,
  longLine,
  readInput,
  takeNum,
  treeLines,
} from "./command-utils.ts";

/**
 * 需要图形化渲染的输出，由 UI 层认领。
 * 文字在这里算好（所以双语和"防漏译"测试都覆盖得到），UI 只负责摆字符画
 */
export type Visual = { render: "neofetch"; info: string[] };

/** 文章元数据。故意不含 body —— 正文按需从 /api/fs 取，别传两份 */
export type PostMeta = { slug: string; title: string; date: string };

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
        .filter(([, c]) => !c.hidden)
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
          "支持管道: cat skills.txt | grep Language | wc -l",
          "Pipes work: cat skills.txt | grep Language | wc -l"
        ),
        ctx.t(
          "支持 cd / Tab 补全 / ↑↓ 历史 / Ctrl+L 清屏。文件系统里也许藏着点东西。",
          "Also cd, Tab completion, ↑↓ history, Ctrl+L to clear. The filesystem hides a few things."
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
      const cmd = COMMANDS[name];
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
      zh: "不带参数显示当前语言。\n首次访问按浏览器语言自动选择，之后记住你的选择。\n只影响系统提示 —— 文章本身不翻译。",
      en: "With no argument, print the current language.\nThe first visit follows your browser; after that your choice is remembered.\nAffects system messages only — articles are not translated.",
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
      zh: "默认隐藏以 . 开头的文件，-a 全部列出，-l 用长格式（权限、大小、时间）。\n输出连到管道时改成一行一个，方便 ls | wc -l。\n权限位是编的 —— 这个文件系统只读，所以谁都没有 w。",
      en: "Hides dotfiles by default; -a lists everything, -l uses the long format.\nWhen the output is a pipe, prints one entry per line so ls | wc -l works.\nThe permission bits are made up — this filesystem is read-only, so nobody gets w.",
    },
    run(args, _stdin, ctx) {
      // -al / -la 这种组合也要认
      const flags = args.filter((a) => a.startsWith("-")).join("");
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
          if (!isDir(node)) return p!;
          const names = entries(node, showAll);
          const body = long
            ? [
                `total ${names.length}`,
                ...names.map((n) => longLine(n, node[n], ctx.stats[[...segs, n].join("/")])),
              ].join("\n")
            : ctx.piped
              ? names.map((n) => n + (isDir(node[n]) ? "/" : "")).join("\n")
              : names.map((n) => n + (isDir(node[n]) ? "/" : "")).join("  ");
          return targets.length > 1 ? `${p}:\n${body}` : body;
        })
        .join("\n\n");
    },
  },

  alias: {
    desc: { zh: "显示命令别名", en: "show command aliases" },
    man: {
      zh: "和真 shell 一样，别名在查命令之前就被展开了 —— ll 实际执行的是 ls -l。",
      en: "Like a real shell, aliases are expanded before the command is looked up — ll really runs ls -l.",
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
      zh: `不带参数回到 ~（也就是 /home/${ME.user}）。支持 .. 和绝对路径。提示符会跟着变。`,
      en: `With no argument, return to ~ (that is, /home/${ME.user}). Understands .. and absolute paths. The prompt follows.`,
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
      zh: "把文件内容输出。没给文件名就读标准输入，所以 cat 也能当管道的中转站。",
      en: "Print file contents. With no file, read standard input — so cat also works mid-pipeline.",
    },
    run: (args, stdin, ctx) => readInput(args, stdin, ctx, "cat"),
  },

  tree: {
    desc: { zh: "树状列出当前目录", en: "list the current directory as a tree" },
    usage: { zh: "tree [-a] [路径]", en: "tree [-a] [path]" },
    man: {
      zh: "从当前目录往下画。想看全貌就 tree /，不过那个有点长。",
      en: "Draws downward from the current directory. Try tree / for the whole thing — it is long.",
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
      zh: "输出匹配的行。-i 忽略大小写。没给文件名就读标准输入。\n模式按正则处理，非法正则退化成普通文本匹配。",
      en: "Print matching lines. -i ignores case. With no file, read standard input.\nThe pattern is a regex; an invalid one falls back to plain substring matching.",
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
    desc: { zh: "列出所有文章（标题和日期）", en: "list all articles with titles and dates" },
    man: {
      zh: "ls posts 只给你文件名，这个给标题和日期，按时间倒序。\n用 open posts/<文件> 打开排版好的版本。",
      en: "ls posts only gives filenames; this gives titles and dates, newest first.\nUse open posts/<file> for the typeset version.",
    },
    run(_args, _stdin, ctx) {
      if (!ctx.posts.length)
        return ctx.t(
          "还没有文章。往 content/posts/ 里丢一个 .md 就有了。",
          "No articles yet. Drop a .md into content/posts/ and one appears."
        );
      const dateW = Math.max(...ctx.posts.map((p) => p.date.length));
      // 标题按显示列数补齐，中文标题后面的路径列才对得齐
      const titleW = Math.max(...ctx.posts.map((p) => displayWidth(p.title)));
      return [
        ...ctx.posts.map(
          (p) => `${p.date.padEnd(dateW)}  ${padCols(p.title, titleW)}  (posts/${p.slug}.md)`
        ),
        "",
        ctx.t(
          "用 open posts/<文件> 打开渲染版（有代码高亮，可以分享）。",
          "Use open posts/<file> for the rendered version (syntax highlighting, shareable)."
        ),
        ...(ctx.lang === "en" ? ["Note: the articles are in Chinese only for now."] : []),
      ].join("\n");
    },
  },

  open: {
    desc: { zh: "在浏览器里打开文章的渲染版", en: "open an article's rendered page in a new tab" },
    usage: { zh: "open posts/<文章>.md", en: "open posts/<article>.md" },
    man: {
      zh: "终端里 cat 出来的是 markdown 源码。\nopen 会新标签打开排版好的文章页（有代码高亮，可以分享给别人）。\n只有 posts/ 里的 .md 有渲染页。",
      en: "In the terminal, cat gives you the markdown source.\nopen loads the typeset page in a new tab (syntax highlighting, shareable).\nOnly .md files under posts/ have a rendered page.",
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
          pad("OS:") + ctx.t("浏览器里的假 Linux", "Fake Linux, in a browser tab"),
          pad("Host:") + `${ME.name} — ${pick(ME.title, ctx.lang)}`,
          pad("Shell:") + "mysite-sh 0.5",
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

  // ---------- 彩蛋 ----------
  sudo: {
    desc: { zh: "以另一个用户身份执行命令", en: "execute a command as another user" },
    hidden: true,
    run(args, _stdin, ctx) {
      if (args.join(" ").includes("rm -rf"))
        throw new Error(
          ctx.t("nice try. 这个网站可是我一行行写的。", "nice try. I wrote this site line by line.")
        );
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

/** 补全用：非隐藏命令名 + 别名。别名也该能 Tab 补出来，否则等于没有 */
export const VISIBLE_COMMANDS = [
  ...Object.keys(COMMANDS).filter((n) => !COMMANDS[n].hidden),
  ...Object.keys(ALIASES),
].sort();
