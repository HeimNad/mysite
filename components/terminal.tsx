"use client";

import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  getNode, HOME, isDir, promptPath, resolvePath,
  type StatDir, type StatMap,
} from "@/lib/terminal/fs";
import { visibleCommands, type Ctx, type PostMeta } from "@/lib/terminal/commands";
import { PACKAGES } from "@/lib/terminal/packages";
import { loginDate } from "@/lib/terminal/command-utils";
import { LANG_KEY, THEME_KEY } from "@/app/preferences";
import { linkify, renderVisual, type ProcTable } from "@/components/terminal-visuals";
import { INIT_PID, type Proc } from "@/lib/terminal/procs";
import { PROC_FILES, PROC_TREE, type Machine } from "@/lib/terminal/procfs";
import { openPager, pagerKey, pagerView, type Pager } from "@/lib/terminal/pager";
import { detectLang, type Lang } from "@/lib/site/i18n";
import { execute } from "@/lib/terminal/shell";
import { ME, SHELL_NAME } from "@/lib/site/me";

export default function Terminal({
  root: rootProp,
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
  // 已装的包 → 内容。初值必须是空的，服务端渲染时什么都没装
  const [pkgs, setPkgs] = useState<Map<string, string>>(new Map());
  const history = useRef<string[]>([]);
  const histIdx = useRef(0);
  const key = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const booted = useRef(false);
  // 读过的文件缓存起来，同一个文件不会请求两次
  const fileCache = useRef(new Map<string, string>());
  // 真在跑的定时器。ps 读它，kill 调它的 stop —— 不需要重渲染，所以放 ref
  const procTable = useRef(new Map<number, Proc & { stop: () => void }>());
  const nextPid = useRef(INIT_PID + 1);
  // 设了就在下一次渲染时抛，交给 error.tsx —— kill -9 1 的下场
  const [panic, setPanic] = useState<string | null>(null);
  // 非 null 时 less 开着，键盘归它。这是这台机器上第一个接管键盘的程序
  const [pager, setPager] = useState<Pager | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);

  // /proc 只挂在客户端：它的内容每次读都要重算，没有静态端点可给
  const root = useMemo(() => ({ ...rootProp, proc: PROC_TREE }), [rootProp]);

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
  const PKGS_KEY = "packages";
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
    // /proc 是活的：每次读都按当下的机器状态重算，不缓存也不走网络
    if (segs[0] === "proc") {
      const make = PROC_FILES[segs.slice(1).join("/")];
      if (make) return make(await machine());
    }
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

  /**
   * 装一个包：真的去 fetch 那个文件，把内容留在内存里，并记下"装过"。
   * 返回真实的字节数和耗时 —— apt 输出里的数字全部来自这里，没有一个是编的
   */
  async function installPkg(name: string): Promise<{ bytes: number; ms: number }> {
    const pkg = PACKAGES[name];
    if (!pkg) throw new Error(`E: Unable to locate package ${name}`);
    const started = performance.now();
    const res = await fetch(pkg.path);
    if (!res.ok)
      throw new Error(`E: Failed to fetch ${pkg.path}  ${res.status} ${res.statusText}`);
    const body = await res.text();
    const ms = performance.now() - started;

    setPkgs((prev) => new Map(prev).set(name, body));
    try {
      const next = [...new Set([...installed(), name])];
      localStorage.setItem(PKGS_KEY, JSON.stringify(next));
    } catch {
      // 隐私模式下记不住，这次会话仍然可用
    }
    // 字节数按 UTF-8 算 —— 那才是网络上真正传输的量
    return { bytes: new TextEncoder().encode(body).length, ms };
  }

  /**
   * 一屏放得下多少行。按真实窗口高度和真实行高算 —— 写死 24 行的话，
   * 手机上会溢出、大屏上会浪费
   */
  function viewportRows(): number {
    const el = screenRef.current;
    const lineHeight = el ? parseFloat(getComputedStyle(el).lineHeight) : 0;
    if (!el || !Number.isFinite(lineHeight) || lineHeight <= 0) return 20;
    // 留两行给状态行和提示符
    return Math.max(5, Math.floor(window.innerHeight / lineHeight) - 2);
  }

  /** 上次装过哪些包 */
  function installed(): string[] {
    try {
      const raw = localStorage.getItem(PKGS_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
    } catch {
      return [];
    }
  }

  /** 动画用它登记自己。名字就是 ps 的 CMD 列 */
  const procs: ProcTable = useMemo(
    () => ({
      spawn(cmd, stop) {
        const pid = nextPid.current++;
        procTable.current.set(pid, { pid, cmd, startedAt: performance.now(), stop });
        return pid;
      },
      exit(pid) {
        procTable.current.delete(pid);
      },
    }),
    []
  );

  /**
   * 访客机器的真实参数。拿不到的一律 null —— Safari 不报 deviceMemory
   * 和 performance.memory，那就是 null，不填一个看着合理的数字
   */
  async function machine(): Promise<Machine> {
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    };
    const nav = navigator as Navigator & { deviceMemory?: number };
    let quota: number | null = null;
    let usage: number | null = null;
    try {
      const est = await navigator.storage?.estimate?.();
      quota = est?.quota ?? null;
      usage = est?.usage ?? null;
    } catch {
      // 权限或隐私模式下会抛，那就是拿不到
    }
    return {
      cores: nav.hardwareConcurrency ?? null,
      memoryGB: nav.deviceMemory ?? null,
      heapUsed: perf.memory?.usedJSHeapSize ?? null,
      heapLimit: perf.memory?.jsHeapSizeLimit ?? null,
      storageQuota: quota,
      storageUsage: usage,
      uptimeMs: performance.now(),
      platform: navigator.userAgent.match(/\(([^;)]+)/)?.[1] ?? null,
    };
  }

  /**
   * curl 和 wttr 用。站内路径照常；站外地址也真的会发出去 ——
   * 这台"机器"确实有网络，只是浏览器只让读那些发了 CORS 头的站点。
   *
   * 跨源被拦时 fetch 抛的是一个不带原因的 TypeError（浏览器故意不告诉脚本），
   * 所以这里只说"没能完成"，不假装知道是 DNS 还是 CORS
   */
  const MAX_BODY = 200_000; // 一次 curl 别把整个终端灌爆

  async function fetchPath(url: string): Promise<string> {
    const external = /^https?:\/\//i.test(url);
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      const host = external ? new URL(url).host : window.location.host;
      throw new Error(
        `curl: (7) Failed to connect to ${host}\n` +
          (lang === "zh"
            ? "请求没能完成。浏览器不会告诉脚本原因；跨站时最常见的是对方没发 Access-Control-Allow-Origin。"
            : "The request did not complete. Browsers never tell a script why; across sites the usual cause is a missing Access-Control-Allow-Origin.")
      );
    }
    if (!res.ok)
      throw new Error(`curl: (22) The requested URL returned error: ${res.status}`);
    const text = (await res.text()).trimEnd();
    return text.length > MAX_BODY
      ? text.slice(0, MAX_BODY) + `\n… (${text.length - MAX_BODY} more bytes)`
      : text;
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
      pkgs,
      install: installPkg,
      asRoot: false,
      // 1 号进程是 shell 自己。起点是 0 —— performance.now() 本来就从页面加载起算，
      // 所以 ps 里它的 ELAPSED 就是这一页开了多久，是真的
      procs: [
        { pid: INIT_PID, cmd: SHELL_NAME, startedAt: 0 },
        ...[...procTable.current.values()].map(({ pid, cmd, startedAt }) => ({ pid, cmd, startedAt })),
      ],
      kill: (pid) => {
        const p = procTable.current.get(pid);
        if (!p) return;
        p.stop();
        procTable.current.delete(pid);
      },
      now: () => performance.now(),
      panic: setPanic,
      machine,
      page: (text, name) => setPager(openPager(text, name, viewportRows())),
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
    // 图形输出由 terminal-visuals 认领 —— 这里不需要知道有哪些变体
    else if (output) push(renderVisual(output, procs));
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
      const m = visibleCommands(pkgs).filter((c) => c.startsWith(partial));
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

    // 输入法组合期间这些键都归输入法：回车是选词不是执行，↑↓ 是翻候选词不是翻历史。
    // 不挡的话中文用户按回车会把半截拼音当命令跑掉
    if (e.nativeEvent.isComposing) return;

    // less 开着的时候键盘归它，提示符一个键也收不到 —— 和真终端一样。
    // q 退出时把这一屏留在输出流里，翻到哪儿就留哪儿
    if (pager) {
      // 搜索输入时把键让给输入框，只截回车和 Esc —— 全都 preventDefault 的话
      // 中文输入法没法合成，一个中文内容为主的站却搜不了中文
      if (pager.typing !== null) {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        e.preventDefault();
        setPager(pagerKey({ ...pager, typing: value }, e.key));
        edit("");
        return;
      }
      e.preventDefault();
      const next = pagerKey(pager, e.key);
      if (next === null) {
        // 退出时把这一屏留在输出流里，翻到哪儿就留哪儿
        pushLine(pagerView(pager).body.join("\n").replace(/\s+$/, ""));
        setPager(null);
      } else {
        setPager(next);
        if (next.typing !== null) edit(""); // 刚按下 /，清空输入框当搜索缓冲
      }
      return;
    }

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
      void run(value); // 异步执行，输入框不阻塞
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
      setInput(complete(value));
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

      // 上次装过的包要还在 —— dpkg 的数据库不会因为你关了终端就清空。
      // 内容不进 localStorage（30 kB 起步，配额不该花在这），重新取一次即可，
      // 浏览器缓存会兜住，所以这一步实际上不走网络
      for (const name of installed()) {
        if (Object.hasOwn(PACKAGES, name)) void installPkg(name).catch(() => {});
      }

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
    // pager 也要进依赖：less 打开时 lines 不变，不滚的话整个分页器渲染在屏幕外，
    // 命令敲完看上去什么都没发生
  }, [lines, pager]);

  // 渲染期抛才会被 error.tsx 接住 —— 命令层的异常会被 shell 的 try/catch 吃掉
  if (panic) throw new Error(panic);

  return (
    <div
      id="terminal"
      onClick={() => {
        if (!getSelection()?.toString()) inputRef.current?.focus();
      }}
    >
      {/* role=log + aria-live：命令输出是逐条追加的，读屏软件得跟着念，
          否则敲完 help 屏幕上多了一大段而它一声不吭 */}
      <div role="log" aria-live="polite" aria-atomic="false" ref={screenRef}>
        {lines}
      </div>
      {pager && (
        <div className="pager">
          <pre>{pagerView(pager).body.join("\n")}</pre>
          <div className="pager-status">{pagerView(pager).status}</div>
        </div>
      )}
      {/* less 开着时提示符看不见，但输入框必须留在可聚焦状态 ——
          用 hidden 属性会让它收不到任何按键，less 就成了摆设 */}
      <div className={"input-line" + (pager ? " captured" : "")}>
        <span className="prompt">{prompt}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // 搜索态下输入框就是搜索缓冲，状态行跟着它走
            if (pager && pager.typing !== null)
              setPager({ ...pager, typing: e.target.value });
          }}
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
