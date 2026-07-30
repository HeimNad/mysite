"use client";

import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import {
  getNode, HOME, isDir, promptPath, resolvePath,
  type StatDir, type StatMap,
} from "@/lib/fs";
import { VISIBLE_COMMANDS, type PostMeta } from "@/lib/commands";
import { detectLang, type Lang } from "@/lib/i18n";
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

export default function Terminal({
  root,
  posts,
  stats,
}: {
  root: StatDir;
  posts: PostMeta[];
  stats: StatMap;
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
  // 开场动画只是装饰，用户随时可以打断。输入框绝不 disabled ——
  // 一旦动画因为任何原因没跑完，disabled 会把人永久锁在外面
  const bootAborted = useRef(false);

  const prompt = `${ME.user}@${ME.host}:${promptPath(cwd)}$ `;

  function push(node: ReactNode) {
    setLines((prev) => [...prev, <Fragment key={key.current++}>{node}</Fragment>]);
  }
  function pushLine(text: string, cls = "") {
    push(<div className={"line" + (cls ? " " + cls : "")}>{linkify(text)}</div>);
  }

  /** 命令历史跨刷新保留，像 ~/.bash_history。留最近 200 条，别让 localStorage 无限长 */
  const HISTORY_KEY = "history";
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

  /** 换语言：记住选择，同时更新 <html lang> 让读屏软件跟上 */
  function setLang(next: Lang) {
    setLangState(next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("lang", next);
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
    const { output, error } = await execute(cmdInput, {
      root,
      cwd,
      setCwd,
      clear: () => { cleared = true; },
      // 在按键处理里调用，算用户手势，不会被弹窗拦截
      openUrl: (url) => window.open(url, "_blank", "noopener"),
      toggleTheme: () => {
        const el = document.documentElement;
        el.dataset.theme = el.dataset.theme === "amber" ? "" : "amber";
      },
      read: readFile,
      lang,
      setLang,
      t: (zh, en) => (lang === "zh" ? zh : en),
      history: history.current,
      posts,
      stats,
    });

    if (cleared) return setLines([]);
    if (error) pushLine(error, "err");
    else if (typeof output === "string") { if (output) pushLine(output); }
    else if (output?.render === "neofetch") push(<Neofetch info={output.info} />);
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

  /** 改写输入内容并把光标放到指定位置 —— readline 那几个键都要用 */
  function edit(value: string, caret = value.length) {
    setInput(value);
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(caret, caret));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    bootAborted.current = true; // 用户开始打字了，动画让路
    const el = e.currentTarget;
    const caret = el.selectionStart ?? input.length;

    // ---- readline 键位：终端用户的肌肉记忆，按下去没反应会立刻出戏 ----
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      switch (e.key) {
        case "a": // 行首
          e.preventDefault();
          return edit(input, 0);
        case "e": // 行尾
          e.preventDefault();
          return edit(input, input.length);
        case "u": // 删到行首（bash 的语义，不是清空整行）
          e.preventDefault();
          return edit(input.slice(caret), 0);
        case "k": // 删到行尾
          e.preventDefault();
          return edit(input.slice(0, caret), caret);
        case "w": {
          // 删掉光标前的一个词：先吃掉空格，再吃掉非空格
          e.preventDefault();
          const left = input.slice(0, caret).replace(/\S+\s*$/, "");
          return edit(left + input.slice(caret), left.length);
        }
        case "c": {
          // 有选中内容时让浏览器去复制 —— 真终端也是靠 Ctrl+Shift+C 区分的
          if (window.getSelection()?.toString()) return;
          e.preventDefault();
          push(
            <div className="line">
              <span className="prompt">{prompt}</span>
              {input}
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

  // 开场：打字动画执行 neofetch
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      // 先定语言：记住的选择优先，否则看浏览器 —— 外国访客不该需要先学会敲 lang。
      // 初值和服务端一样是 zh，检测放在这里而不是渲染期，避免 hydration 不匹配
      const saved = (() => {
        try {
          return localStorage.getItem("lang");
        } catch {
          return null; // 隐私模式下会抛
        }
      })();
      const initial: Lang =
        saved === "zh" || saved === "en"
          ? saved
          : detectLang(navigator.languages ?? [navigator.language]);
      if (initial !== "zh") setLang(initial);

      // 恢复上次的命令历史，↑ 立刻就能翻到
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) {
          history.current = parsed.filter((h): h is string => typeof h === "string");
          histIdx.current = history.current.length;
        }
      } catch {
        // 存坏了就当没有，不值得为此中断启动
      }

      const boot = "neofetch";
      for (let i = 1; i <= boot.length; i++) {
        if (bootAborted.current) return; // 用户抢先动手了，动画到此为止
        setInput(boot.slice(0, i));
        await sleep(70);
      }
      await sleep(300);
      if (bootAborted.current) return;
      await run(boot);
      setInput("");
      // 用 initial 而不是 lang —— setLang 要等下一次渲染才生效
      pushLine(
        initial === "zh"
          ? "\n输入 help 开始探索。管道、cd、man 都是真的。"
          : "\nType help to start. The pipes, cd and man pages are real.\nRunning in English — use `lang zh` for Chinese.",
        "dim"
      );
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
          aria-label="终端输入"
        />
      </div>
      <div ref={endRef} />
    </div>
  );
}
