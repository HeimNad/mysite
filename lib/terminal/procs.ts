// 进程表。这台机器上"跑着的东西"是真的：sl 的火车、donut 的圆环，
// 都是页面上真实存在的定时器。ps 列的是它们，kill 真的把它们停掉。
//
// 这里只有类型和排版（纯函数，可测）；表本身活在 UI 层，因为定时器在那里

export type Proc = {
  pid: number;
  /** ps 的 CMD 列 */
  cmd: string;
  /** performance.now() 的时刻，ELAPSED 由它算出来 */
  startedAt: number;
};

/** 这台机器的 1 号进程：shell 自己。它随页面一起诞生，杀不掉 */
export const INIT_PID = 1;

/** 62 → "01:02"，超过一小时加上小时段，和 ps -o etime 一致 */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  const s = p(total % 60);
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${p(m)}:${s}` : `${p(m)}:${s}`;
}

/**
 * ps 的输出。用 ELAPSED 而不是真 ps 默认的 TIME ——
 * TIME 是 CPU 时间，浏览器里量不到，写上去就是假的。ELAPSED 是真的
 */
export function psTable(procs: Proc[], now: number): string {
  const rows = [...procs].sort((a, b) => a.pid - b.pid);
  return [
    "    PID TTY      ELAPSED CMD",
    ...rows.map(
      (p) =>
        String(p.pid).padStart(7) +
        " pts/0   " +
        elapsed(now - p.startedAt).padStart(8) +
        " " +
        p.cmd
    ),
  ].join("\n");
}
