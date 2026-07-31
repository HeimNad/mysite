"use client";

import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import {
  getNode, HOME, isDir, promptPath, resolvePath,
  type StatDir, type StatMap,
} from "@/lib/fs";
import { VISIBLE_COMMANDS, type Ctx, type PostMeta } from "@/lib/commands";
import { loginDate } from "@/lib/command-utils";
import { LANG_KEY, THEME_KEY } from "./preferences";
import { detectLang, type Lang } from "@/lib/i18n";
import { donutFrame } from "@/lib/donut";
import { execute } from "@/lib/shell";
import { ME } from "@/lib/me";
import avatarAscii from "@/lib/avatar-ascii.json";

const PALETTE = ["#f85149", "#39d353", "#ffd75f", "#58a6ff", "#bc8cff", "#39c5cf", "#c9d1d9"];

/** 文本里的 URL 和邮箱变成可点的链接 */
function linkify(text: string): ReactNode {
  return text.split(/(https?:\/\/[^\s]+|[\w.]+@[\w.]+\.\w{2,})/g).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a>
    ) : /^[\w.]+@[\w.]+\.\w{2,}$/.test(p) ? (
      <a key={i} href={`mailto:${p}`}>{p}</a>
    ) : (
      p
    )
  );
}

/** 文字由 neofetch 命令算好传进来，这里只管把字符画和信息摆一起 */
function Neofetch({ info }: { info: string[] }) {
  return (
    <div className="neofetch">
      <pre className="art">
        {avatarAscii.map((runs, y) => (
          <div key={y}>
            {runs.map((r, i) =>
              r.color ? (
                <span key={i} style={{ color: r.color }}>{r.text}</span>
              ) : (
                r.text
              )
            )}
          </div>
        ))}
      </pre>
      <pre className="info">
        {linkify(info.join("\n"))}
        {"\n\n"}
        {PALETTE.map((c) => (
          <span key={c} style={{ color: c }}>███</span>
        ))}
      </pre>
    </div>
  );
}

// 自己画的火车，不是原版 sl 的那张图。烟雾两帧交替
const SMOKE = [
  ["   (  ) (@@) ( )", "  (@@@)   (  )  ", " (   ) (@@@@)   "],
  ["  (@@) (  ) (@@)", " (   )  (@@@)   ", "(@@@@)  (   )   "],
];
const TRAIN = [
  "      _____",
  "  ___|[_]_|____________     ____________",
  " |             |  ___  |   |  __    __  |",
  " |   H E I M   | |[o]| |===|  ||    ||  |",
  " |_____________|_|___|_|   |____________|",
  "   (O)     (O)   (o) (o)     (o)    (o)",
];
const TRAIN_W = Math.max(...TRAIN.map((l) => l.length));
const TRACK_W = 78; // 经典终端宽度，够它开一段

/** sl：火车从右往左开过去，开完这块自己塌掉，输出流上不留空洞 */
function Sl() {
  const [x, setX] = useState(TRACK_W);

  useEffect(() => {
    // 尊重系统的「减少动态效果」——静态摆一辆，别硬动
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setX((v) => v - 2), 55);
    return () => clearInterval(id);
  }, []);

  if (x <= -TRAIN_W) return null; // 开过去了

  const pad = (line: string) =>
    x >= 0 ? " ".repeat(x) + line : line.slice(-x);
  const smoke = SMOKE[Math.floor(x / 4) % 2 === 0 ? 0 : 1];

  return (
    <pre className="sl" aria-label="一列火车开了过去 / a train went by">
      {[...smoke.map((s) => "      " + s), ...TRAIN].map(pad).join("\n")}
    </pre>
  );
}

/** 甜甜圈：角度推进由这里管，每帧的形状是 donutFrame 算的。转一阵就停，别一直烧 CPU */
function Donut() {
  const SPIN_MS = 12_000;
  // 不从 (0,0) 起：那个角度环面正好侧对着看，只剩一条窄带，当第一帧太空
  const [angle, setAngle] = useState({ a: 1.0, b: 0.5 });

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setAngle((v) => ({ a: v.a + 0.07, b: v.b + 0.03 })), 50);
    const stop = setTimeout(() => clearInterval(id), SPIN_MS);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, []);

  return (
    <pre className="sl" aria-label="一个旋转的甜甜圈 / a spinning donut">
      {donutFrame(angle.a, angle.b)}
    </pre>
  );
}

export default function Terminal({
  root,
  posts,
  stats,
  mode = "login",
}: {
  root: StatDir;
  posts: PostMeta[];
  stats: StatMap;
  /** notFound 时开场换成一条 shell 报错，提示符照样能用 */
  mode?: "login" | "notFound";
}) {
  const [lines, setLines] = useState<ReactNode[]>([]);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState<string[]>(HOME);
  // 初值必须和服务端一致，否则 hydration 不匹配；真正的语言在 boot 里定
  const [lang, setLangState] = useState<Lang>("zh");
  const history = useRef<string[]>([]);
  const histIdx = useRef(0);
  const key = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const booted = useRef(false);
  // 读过的文件缓存起来，同一个文件不会请求两次
  const fileCache = useRef(new Map<string, string>());

  const prompt = `${ME.user}@${ME.host}:${promptPath(cwd)}$ `;

  function push(node: ReactNode) {
    setLines((prev) => [...prev, <Fragment key={key.current++}>{node}</Fragment>]);
  }
  function pushLine(text: string, cls = "") {
    push(<div className={"line" + (cls ? " " + cls : "")}>{linkify(text)}</div>);
  }

  /** 命令历史跨刷新保留，像 ~/.bash_history。留最近 200 条，别让 localStorage 无限长 */
  const HISTORY_KEY = "history";
  const LAST_LOGIN_KEY = "lastLogin";
  const HISTORY_MAX = 200;

  function saveHistory() {
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(history.current.slice(-HISTORY_MAX))
      );
    } catch {
      // 隐私模式或超配额：记不住就算了，不该因此崩掉
    }
  }

  /** 换主题：和语言一样要记住，否则刷新或跳到文章页就丢了 */
  function toggleTheme() {
    const el = document.documentElement;
    const next = el.dataset.theme === "amber" ? "" : "amber";
    el.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // 隐私模式下记不住，但当前这一页仍然生效
    }
  }

  /** 换语言：记住选择，同时更新 <html lang> 让读屏软件跟上 */
  function setLang(next: Lang) {
    setLangState(next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // 隐私模式下 localStorage 会抛，记不住就算了，不该因此崩掉
    }
  }

  /** 按需取文件内容，命令层通过 ctx.read 调用 */
  async function readFile(segs: string[]): Promise<string> {
    const key = segs.join("/");
    const hit = fileCache.current.get(key);
    if (hit !== undefined) return hit;
    const res = await fetch("/api/fs/" + segs.map(encodeURIComponent).join("/"));
    if (!res.ok) throw new Error(`无法读取 /${key}（${res.status}）`);
    const text = await res.text();
    fileCache.current.set(key, text);
    return text;
  }

  /**
   * 后台预热：一次请求把常用文件全灌进缓存，之后 cat 不用等往返。
   * 纯优化 —— 失败了也没关系，单个文件的按需请求仍然兜得住
   */
  async function warmCache() {
    try {
      const res = await fetch("/api/fs-bundle");
      if (!res.ok) return;
      const files: unknown = await res.json();
      if (!files || typeof files !== "object") return;
      for (const [path, body] of Object.entries(files as Record<string, unknown>)) {
        // 已经读过的不覆盖，免得盖掉更新的内容
        if (typeof body === "string" && !fileCache.current.has(path))
          fileCache.current.set(path, body);
      }
    } catch {
      // 预热失败不该让任何事情出错
    }
  }

  /** curl 用：取本站某个路径。非 2xx 按 curl -f 的说法报错，不然会吐出一整页 404 HTML */
  async function fetchPath(path: string): Promise<string> {
    const res = await fetch(path);
    if (!res.ok)
      throw new Error(`curl: (22) The requested URL returned error: ${res.status}`);
    return (await res.text()).trimEnd();
  }

  /** ctx 的构造。开场序列也要用，所以抽出来 —— lang 可以覆盖，因为 setLang 要下一轮渲染才生效 */
  function makeCtx(langNow: Lang, onClear: () => void = () => {}): Omit<Ctx, "piped"> {
    return {
      root,
      cwd,
      setCwd,
      clear: onClear,
      // 在按键处理里调用，算用户手势，不会被弹窗拦截
      openUrl: (url) => window.open(url, "_blank", "noopener"),
      toggleTheme,
      read: readFile,
      http: fetchPath,
      lang: langNow,
      setLang,
      t: (zh, en) => (langNow === "zh" ? zh : en),
      history: history.current,
      posts,
      stats,
    };
  }

  async function run(raw: string) {
    const cmdInput = raw.trim();
    push(
      <div className="line">
        <span className="prompt">{prompt}</span>
        {cmdInput}
      </div>
    );
    if (!cmdInput) return;

    history.current.push(cmdInput);
    histIdx.current = history.current.length;
    saveHistory();

    let cleared = false;
    const { output, error } = await execute(
      cmdInput,
      makeCtx(lang, () => {
        cleared = true;
      })
    );

    if (cleared) return setLines([]);
    if (error) pushLine(error, "err");
    else if (typeof output === "string") { if (output) pushLine(output); }
    else if (output?.render === "neofetch") push(<Neofetch info={output.info} />);
    else if (output?.render === "sl") push(<Sl />);
    else if (output?.render === "donut") push(<Donut />);
  }

  // Tab 补全：管道后仍然补全命令，路径相对 cwd
  function complete(text: string): string {
    const stage = text.split("|").pop()!;
    const leading = text.slice(0, text.length - stage.length);
    const parts = stage.split(/\s+/);
    const hasTrailingSpace = /\s$/.test(stage);
    const candidates: string[] = [];
    let replacement = stage;

    if (parts.length === 1 && !hasTrailingSpace) {
      const partial = parts[0].trimStart();
      const m = VISIBLE_COMMANDS.filter((c) => c.startsWith(partial));
      if (m.length === 1) replacement = stage.replace(/\S*$/, m[0] + " ");
      else candidates.push(...m);
    } else {
      const last = hasTrailingSpace ? "" : parts[parts.length - 1];
      const slash = last.lastIndexOf("/");
      const dirPath = slash >= 0 ? last.slice(0, slash + 1) : "";
      const partial = slash >= 0 ? last.slice(slash + 1) : last;
      const dir = getNode(root, resolvePath(cwd, dirPath || undefined));
      if (isDir(dir)) {
        const m = Object.keys(dir).filter(
          (n) => n.startsWith(partial) && (partial.startsWith(".") || !n.startsWith("."))
        );
        if (m.length === 1) {
          const full = dirPath + m[0] + (isDir(dir[m[0]]) ? "/" : " ");
          replacement = hasTrailingSpace ? stage + full : stage.replace(/\S*$/, full);
        } else candidates.push(...m);
      }
    }

    if (candidates.length > 1) pushLine(candidates.join("  "), "dim");
    return leading + replacement;
  }

  /**
   * 改写输入内容并把光标放到指定位置。直接写 DOM 再同步 state ——
   * 之前是 setState + requestAnimationFrame 补光标，但用户刚打完字时 state 还没同步，
   * 闭包里拿到的是旧值，Ctrl+E 就会算错位置
   */
  function edit(value: string, caret = value.length) {
    const el = inputRef.current;
    if (el) {
      el.value = value;
      el.setSelectionRange(caret, caret);
    }
    setInput(value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    // 一律以 DOM 为准，不读 state —— state 可能还没跟上刚刚敲进去的那个字符
    const value = el.value;
    const caret = el.selectionStart ?? value.length;

    // ---- readline 键位：终端用户的肌肉记忆，按下去没反应会立刻出戏 ----
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      switch (e.key) {
        case "a": // 行首
          e.preventDefault();
          return edit(value, 0);
        case "e": // 行尾
          e.preventDefault();
          return edit(value, value.length);
        case "u": // 删到行首（bash 的语义，不是清空整行）
          e.preventDefault();
          return edit(value.slice(caret), 0);
        case "k": // 删到行尾
          e.preventDefault();
          return edit(value.slice(0, caret), caret);
        case "w": {
          // 删掉光标前的一个词：先吃掉空格，再吃掉非空格
          e.preventDefault();
          const left = value.slice(0, caret).replace(/\S+\s*$/, "");
          return edit(left + value.slice(caret), left.length);
        }
        case "c": {
          // 有选中内容时让浏览器去复制 —— 真终端也是靠 Ctrl+Shift+C 区分的
          if (window.getSelection()?.toString()) return;
          e.preventDefault();
          push(
            <div className="line">
              <span className="prompt">{prompt}</span>
              {value}
              <span className="dim">^C</span>
            </div>
          );
          histIdx.current = history.current.length;
          return edit("");
        }
        case "l":
          e.preventDefault();
          return setLines([]);
      }
    }

    if (e.key === "Enter") {
      void run(input); // 异步执行，输入框不阻塞
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx.current > 0) setInput(history.current[--histIdx.current]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx.current < history.current.length - 1)
        setInput(history.current[++histIdx.current]);
      else {
        histIdx.current = history.current.length;
        setInput("");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      setInput(complete(input));
    }
  }

  /**
   * 开场 = 一次 SSH 登录：先 lastlog 那行，再 motd，最后 shell 跑 ~/.bashrc（里面是 neofetch）。
   * 之前的打字动画其实在假装用户自己敲了命令 —— 真实登录是服务端直接打印，也更快进入可用状态
   */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      // 先定语言：记住的选择优先，否则看浏览器 —— 外国访客不该需要先学会敲 lang。
      // 初值和服务端一样是 zh，检测放在这里而不是渲染期，避免 hydration 不匹配
      const readStore = (k: string) => {
        try {
          return localStorage.getItem(k);
        } catch {
          return null; // 隐私模式下会抛
        }
      };
      const saved = readStore(LANG_KEY);
      const initial: Lang =
        saved === "zh" || saved === "en"
          ? saved
          : detectLang(navigator.languages ?? [navigator.language]);
      if (initial !== "zh") setLang(initial);

      // 恢复上次的命令历史，↑ 立刻就能翻到
      try {
        const raw = readStore(HISTORY_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) {
          history.current = parsed.filter((h): h is string => typeof h === "string");
          histIdx.current = history.current.length;
        }
      } catch {
        // 存坏了就当没有，不值得为此中断启动
      }

      // 404：报错用真实路径，然后把提示符交给用户 —— 它是真能用的
      if (mode === "notFound") {
        const path = window.location.pathname;
        push(
          <div className="line">
            <span className="prompt">{prompt}</span>
            {`cd ${path}`}
          </div>
        );
        pushLine(
          initial === "zh"
            ? `bash: cd: ${path}: 没有那个文件或目录`
            : `bash: cd: ${path}: No such file or directory`,
          "err"
        );
        pushLine(
          initial === "zh" ? "\nhelp 看能做什么，posts 看我写了什么。" : "\nhelp lists what works. posts shows what I have written.",
          "dim"
        );
        void warmCache();
        return;
      }

      // Last login：真的是上次来的时间。第一次来就不打这行，和 lastlog 没有记录时一样
      const previous = readStore(LAST_LOGIN_KEY);
      if (previous) {
        const at = new Date(previous);
        if (!Number.isNaN(at.getTime()))
          pushLine(`Last login: ${loginDate(at)}\n`, "dim");
      }
      try {
        localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString());
      } catch {
        // 记不住就算了
      }

      // 只打 motd。neofetch 留给用户自己敲 —— 登录就糊三十行是没人要看的
      const banner = await execute("motd", makeCtx(initial));
      if (typeof banner.output === "string") pushLine(banner.output);

      // 人读 banner 的这几秒里把文件缓存灌满，不 await —— 它不该拖住任何东西
      void warmCache();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // block:"end" —— 内容装得下时什么都不做，装不下才把底部拉到视口底部。
    // 默认的 block:"start" 会把提示符顶到屏幕上方，把已有输出推出视口
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  return (
    <div
      id="terminal"
      onClick={() => {
        if (!getSelection()?.toString()) inputRef.current?.focus();
      }}
    >
      {/* role=log + aria-live：命令输出是逐条追加的，读屏软件得跟着念，
          否则敲完 help 屏幕上多了一大段而它一声不吭 */}
      <div role="log" aria-live="polite" aria-atomic="false">
        {lines}
      </div>
      <div className="input-line">
        <span className="prompt">{prompt}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={lang === "zh" ? "终端输入" : "Terminal input"}
        />
      </div>
      <div ref={endRef} />
    </div>
  );
}
