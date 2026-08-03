// htop 的排版和键位。纯函数，node --test 直接跑。
//
// 能显示的都是真的：进程是页面上真在跑的定时器，核数和内存来自浏览器，
// TIME+ 是真实运行时长，F9 走的是真的 kill。
//
// 显示不了的一律不编：
//   每进程 CPU%、VIRT/RES/SHR —— 浏览器不提供，任何数字都是假的
//   load average、swap —— 浏览器里根本不存在这两个概念
// 真 htop 有这些列，这里没有。缺一列比填一个看着合理的数字诚实

import { elapsed, type Proc } from "./procs.ts";
import { human, type Machine } from "./procfs.ts";
import { padCols } from "./text.ts";

export type HtopState = { selected: number };

export type HtopAction =
  | { kind: "state"; state: HtopState }
  | { kind: "quit" }
  | { kind: "kill"; pid: number };

/** 按键。上下选进程，F9/k 杀，q/F10 退 */
export function htopKey(state: HtopState, key: string, procs: Proc[]): HtopAction {
  const last = Math.max(0, procs.length - 1);
  const move = (to: number): HtopAction => ({
    kind: "state",
    state: { selected: Math.max(0, Math.min(last, to)) },
  });

  switch (key) {
    case "q":
    case "F10":
    case "Escape":
      return { kind: "quit" };
    case "j":
    case "ArrowDown":
      return move(state.selected + 1);
    case "k":
    case "ArrowUp":
      return move(state.selected - 1);
    case "F9":
    case "K": {
      const pid = procs[state.selected]?.pid;
      return pid === undefined ? { kind: "state", state } : { kind: "kill", pid };
    }
    default:
      return { kind: "state", state };
  }
}

/** 把数字盖在条子右端。宽度不够就只剩数字，别写到方括号外面去 */
function overlay(bar: string, width: number, text: string): string {
  const cells = bar.padEnd(width).split("").slice(0, width);
  const at = Math.max(0, width - text.length);
  for (let i = 0; at + i < width && i < text.length; i++) cells[at + i] = text[i];
  return cells.join("");
}

/** htop 那种方括号计量条。拿不到值时整条留空并写 null，不画一条假的 */
export function meter(label: string, used: number | null, total: number | null, width = 26): string {
  const head = label.padEnd(4);
  if (used === null || total === null || total === 0)
    return `${head}[${"null".padEnd(width)}]`;
  const ratio = Math.max(0, Math.min(1, used / total));
  const filled = Math.round(ratio * width);
  // 数字压在条子右边，和真 htop 一样。条子比数字还窄时只放得下数字本身
  return `${head}[${overlay("|".repeat(filled), width, `${human(used)}/${human(total)}`)}]`;
}

/** 百分比计量条，给事件循环延迟用 */
export function percentMeter(label: string, pct: number | null, width = 26): string {
  const head = label.padEnd(4);
  if (pct === null) return `${head}[${"null".padEnd(width)}]`;
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return `${head}[${overlay("|".repeat(filled), width, `${p.toFixed(1)}%`)}]`;
}

export type HtopInput = {
  procs: Proc[];
  machine: Machine;
  /** 事件循环延迟换算的忙碌程度。这是能量到的唯一"CPU"信号 */
  lagPercent: number | null;
  state: HtopState;
  now: number;
  user: string;
  rows: number;
};

export function htopView(i: HtopInput): {
  header: string[];
  rows: string[];
  /** rows 里第几行反色，UI 层照这个画 */
  selected: number;
  fkeys: string[];
} {
  const { machine: m } = i;
  const header = [
    // 这是浏览器里唯一量得到的"忙"：主线程卡住时定时器会晚到
    percentMeter("CPU", i.lagPercent),
    // 堆用量是这张页面真实占的内存。整机内存 deviceMemory 太粗，不放进条子里
    meter("Mem", m.heapUsed, m.heapLimit),
    "",
    `  Tasks: ${i.procs.length}    Cores: ${m.cores ?? "null"}    Uptime: ${elapsed(m.uptimeMs)}`,
    "",
    "  PID USER      S     TIME+  COMMAND",
  ];

  // 表格占掉计量条和功能键之外的地方
  const room = Math.max(1, i.rows - header.length - 2);
  const shown = i.procs.slice(0, room);
  const rows = shown.map(
    (p) =>
      String(p.pid).padStart(5) +
      " " +
      padCols(i.user, 9) +
      " R " +
      elapsed(i.now - p.startedAt).padStart(9) +
      "  " +
      p.cmd
  );

  return {
    header,
    rows,
    selected: Math.min(i.state.selected, Math.max(0, rows.length - 1)),
    fkeys: ["F9 Kill", "F10 Quit", "↑↓ Select"],
  };
}
