"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { donutFrame } from "@/lib/terminal/donut";
import type { Visual } from "@/lib/terminal/commands";
import { vimView, type Vim } from "@/lib/terminal/vim";
import avatarAscii from "@/components/avatar-ascii.json";

/**
 * 动画把自己登记成进程，ps 列的就是这些。kill 调用 stop 真的把定时器停掉 ——
 * 表活在 UI 层是因为定时器在这里，命令层只拿到快照和一个回调
 */
export type ProcTable = {
  /** 登记一个正在跑的东西，返回 pid */
  spawn: (cmd: string, stop: () => void) => number;
  /** 自然结束或被卸载时注销 */
  exit: (pid: number) => void;
};

// 终端里那些不是纯文本的输出：命令返回一个标记，由这里认领渲染。
// 文字都在命令层算好（所以双语和防漏译的测试覆盖得到），这里只负责摆

/**
 * Visual → 组件。认领表放在组件旁边，terminal.tsx 因此不必知道有哪些变体。
 *
 * default 里那行 never 是关键：给 Visual 加了新变体却忘了在这里认领时，
 * 它编译不过。以前这里是 terminal.tsx 里一串 else if，漏一个不会报错 ——
 * 命令能跑、返回了标记、屏幕上什么都不出现，只能等谁敲到那条命令才发现
 */
export function renderVisual(v: Visual, procs: ProcTable): ReactNode {
  switch (v.render) {
    case "neofetch":
      return <Neofetch info={v.info} />;
    case "sl":
      return <Sl procs={procs} />;
    case "donut":
      return <Donut procs={procs} />;
    default: {
      const missing: never = v;
      return missing;
    }
  }
}

const PALETTE = ["#f85149", "#39d353", "#ffd75f", "#58a6ff", "#bc8cff", "#39c5cf", "#c9d1d9"];

/** 文本里的 URL 和邮箱变成可点的链接 */
export function linkify(text: string): ReactNode {
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
export function Neofetch({ info }: { info: string[] }) {
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
const STEP_PX = 2;
const STEP_MS = 55;
/** 从右边缘开到完全离开左边缘要多久 —— 到点停表，别让它空转下去 */
const RUN_MS = Math.ceil((TRACK_W + TRAIN_W) / STEP_PX) * STEP_MS;

/** sl：火车从右往左开过去，开完这块自己塌掉，输出流上不留空洞 */
export function Sl({ procs }: { procs: ProcTable }) {
  const [x, setX] = useState(TRACK_W);
  const doneRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // 尊重系统的「减少动态效果」——静态摆一辆，别硬动
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setX((v) => v - STEP_PX), STEP_MS);
    // 开过去之后必须停表：下面的 return null 只是不再渲染，组件并没有卸载，
    // 不停的话它会一直 setState 下去，连敲几次 sl 就挂着几个永不停的定时器
    // kill 走这个回调：车当场停在原地，和终止一个真进程一样。
    // 定时器句柄放 ref，因为登记 stop 的时候它还没创建出来
    const pid = procs.spawn("sl", () => {
      clearInterval(id);
      clearTimeout(doneRef.current);
    });
    doneRef.current = setTimeout(() => {
      clearInterval(id);
      procs.exit(pid);
    }, RUN_MS);
    return () => {
      clearInterval(id);
      clearTimeout(doneRef.current);
      procs.exit(pid);
    };
  }, [procs]);

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
export function Donut({ procs }: { procs: ProcTable }) {
  const SPIN_MS = 12_000;
  // 不从 (0,0) 起：那个角度环面正好侧对着看，只剩一条窄带，当第一帧太空
  const [angle, setAngle] = useState({ a: 1.0, b: 0.5 });
  const doneRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setAngle((v) => ({ a: v.a + 0.07, b: v.b + 0.03 })), 50);
    const pid = procs.spawn("donut", () => {
      clearInterval(id);
      clearTimeout(doneRef.current);
    });
    doneRef.current = setTimeout(() => {
      clearInterval(id);
      procs.exit(pid);
    }, SPIN_MS);
    return () => {
      clearInterval(id);
      clearTimeout(doneRef.current);
      procs.exit(pid);
    };
  }, [procs]);

  return (
    <pre className="sl" aria-label="一个旋转的甜甜圈 / a spinning donut">
      {donutFrame(angle.a, angle.b)}
    </pre>
  );
}

/**
 * vim 的屏幕。光标是真的画出来的方块 —— 它标的是缓冲区里的位置，
 * 不是一个装饰性的闪烁条：h/j/k/l 走到哪它就在哪
 */
export function VimScreen({ vim, hint }: { vim: Vim; hint: string }) {
  const { body, status, cursor } = vimView(vim);
  return (
    <div className="vim">
      <pre>
        {body.map((text, i) => {
          if (i !== cursor.row) return <div key={i}>{text || " "}</div>;
          // 光标那一行拆成三段，中间那个字符反色
          const at = text[cursor.col] ?? " ";
          return (
            <div key={i}>
              {text.slice(0, cursor.col)}
              <span className="vim-cursor">{at}</span>
              {text.slice(cursor.col + 1)}
            </div>
          );
        })}
      </pre>
      <div className="vim-status">
        {status}
        {/* 合成中的拼音要看得见，否则中文是盲打 */}
        {hint && <span className="vim-compose">{hint}</span>}
      </div>
    </div>
  );
}

/**
 * 模式激活时屏幕上的按键栏。触屏软键盘没有 Esc —— 没有它，vim 的插入模式
 * 就是个出不来的死胡同，只能刷新页面。桌面端有物理键盘，CSS 里藏起来。
 *
 * 单独成组件而不是写在 terminal.tsx 里：那边的一堆辅助函数会被 React 编译器
 * 拉进这个 map 的记忆化范围，报一串"不能在渲染期调用"
 */
export function ModeKeys({
  keys,
  onKey,
  label,
}: {
  keys: readonly { label: string; key: string }[];
  onKey: (key: string) => void;
  label: string;
}) {
  return (
    <div className="keybar" aria-label={label}>
      {keys.map((k) => (
        <button
          key={k.key}
          type="button"
          // 按下时别让输入框失焦，否则软键盘会收起来
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onKey(k.key)}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
