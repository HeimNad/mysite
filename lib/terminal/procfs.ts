// /proc 和它的衍生命令（uname / free / df）。
//
// 这是整台假机器上最真的一块：核数、内存、存储配额都来自访客自己的浏览器。
// 但不是每个浏览器都肯说 —— 实测 Safari/iOS 上 deviceMemory 和 performance.memory
// 都拿不到。拿不到就写 null，绝不填一个看起来合理的假数字。
//
// 于是同一条命令在 Chrome 和 Safari 上给出不同的结果，而那个差异本身是真的。
//
// 这里只做格式化（纯函数，可测）；读浏览器 API 的活在 UI 层，通过 Ctx 注入

import { OS_NAME, SHELL_NAME, VERSION } from "../site/me.ts";

export type Machine = {
  /** navigator.hardwareConcurrency。每个浏览器都有 */
  cores: number | null;
  /** navigator.deviceMemory，单位 GB。粗粒度，且只有 Chromium 系报 */
  memoryGB: number | null;
  /** performance.memory 的两个值，字节。Chrome 独占 */
  heapUsed: number | null;
  heapLimit: number | null;
  /** navigator.storage.estimate()，字节 */
  storageQuota: number | null;
  storageUsage: number | null;
  /** performance.now()：这一页开了多久 */
  uptimeMs: number;
  /** 平台标识，uname 的机器名那一列 */
  platform: string | null;
};

/** 拿不到就是 null —— 字面量的 null，不是"未知"也不是 0 */
const val = (n: number | null, unit = "") => (n === null ? "null" : `${n}${unit}`);

/** 字节 → kB。/proc 里的数字历来是 kB，1024 进制 */
const kb = (bytes: number | null) => (bytes === null ? null : Math.round(bytes / 1024));

/** 左边字段名、右边值，照 /proc 的排版 */
const row = (label: string, value: string, width = 16) => label.padEnd(width) + value;

/**
 * /proc/cpuinfo。每个逻辑处理器一段，和真 Linux 一样 ——
 * 所以 grep processor /proc/cpuinfo | wc -l 这个老把戏在这儿也成立
 */
export function cpuinfo(m: Machine): string {
  if (m.cores === null) return row("processor", ": null");
  return Array.from({ length: m.cores }, (_, i) =>
    [
      row("processor", `: ${i}`),
      // 型号和厂商浏览器一律不说 —— 说了才是编的
      row("vendor_id", ": null"),
      row("model name", ": null"),
    ].join("\n")
  ).join("\n\n");
}

/** /proc/meminfo。MemTotal 来自 deviceMemory；空闲量浏览器不报 */
export function meminfo(m: Machine): string {
  const total = m.memoryGB === null ? null : m.memoryGB * 1024 * 1024;
  return [
    row("MemTotal:", `${val(total)}${total === null ? "" : " kB"}`),
    row("MemFree:", "null"),
    row("MemAvailable:", "null"),
  ].join("\n");
}

/** /proc/self/status：这个"进程"就是这张页面，VmRSS 是它真实占用的 JS 堆 */
export function selfStatus(m: Machine): string {
  const rss = kb(m.heapUsed);
  const size = kb(m.heapLimit);
  return [
    row("Name:", SHELL_NAME, 12),
    row("State:", "R (running)", 12),
    row("VmSize:", `${val(size)}${size === null ? "" : " kB"}`, 12),
    row("VmRSS:", `${val(rss)}${rss === null ? "" : " kB"}`, 12),
  ].join("\n");
}

/**
 * /proc/uptime。真 Linux 这里是两个数：运行时长和空闲时长。
 * 第一个是真的，第二个浏览器不可能知道
 */
export function uptimeFile(m: Machine): string {
  return `${(m.uptimeMs / 1000).toFixed(2)} null`;
}

/** /proc/version。这一整行都是真的 —— 版本号就是这份代码的 commit */
export function versionFile(m: Machine): string {
  return `${OS_NAME} version ${VERSION} (${SHELL_NAME}@${m.platform ?? "null"}) #1 SMP`;
}

/** 路径 → 内容。/proc 是活的，每次读都重算，所以不走 /api/fs */
export const PROC_FILES: Record<string, (m: Machine) => string> = {
  cpuinfo,
  meminfo,
  uptime: uptimeFile,
  version: versionFile,
  "self/status": selfStatus,
};

/** 客户端把它并进目录树。值是 null 表示文件，和 StatDir 的约定一致 */
export const PROC_TREE = {
  cpuinfo: null,
  meminfo: null,
  uptime: null,
  version: null,
  self: { status: null },
};

/** 1536 → "1.5G"。df -h 和 free -h 用，1024 进制 */
export function human(bytes: number | null): string {
  if (bytes === null) return "null";
  const units = ["B", "K", "M", "G", "T"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 ? String(n) : n.toFixed(1)) + units[i];
}

export function unameLine(m: Machine, all: boolean): string {
  if (!all) return OS_NAME;
  return [OS_NAME, "web", VERSION, "#1 SMP", m.platform ?? "null", SHELL_NAME].join(" ");
}

export function freeTable(m: Machine): string {
  const total = m.memoryGB === null ? null : m.memoryGB * 1024 ** 3;
  return [
    "               total        used        free",
    "Mem:    " + human(total).padStart(12) + "null".padStart(12) + "null".padStart(12),
    // 这一行是真的：JS 堆是这张页面实际用掉的内存
    "Heap:   " +
      human(m.heapLimit).padStart(12) +
      human(m.heapUsed).padStart(12) +
      human(m.heapLimit === null || m.heapUsed === null ? null : m.heapLimit - m.heapUsed).padStart(12),
  ].join("\n");
}

/**
 * df。这台机器只有一块"盘"：浏览器给这个站点的存储配额。
 * 历史、语言、主题和装过的包都存在上面，所以 Used 是真的在动的
 */
export function dfTable(m: Machine, mount: string): string {
  const { storageQuota: quota, storageUsage: used } = m;
  const avail = quota === null || used === null ? null : quota - used;
  const pct = quota === null || used === null || quota === 0 ? "null" : `${Math.round((used / quota) * 100)}%`;
  return [
    "Filesystem      Size  Used Avail Use% Mounted on",
    "/dev/sda1 " +
      human(quota).padStart(9) +
      human(used).padStart(6) +
      human(avail).padStart(6) +
      pct.padStart(5) +
      " " +
      mount,
  ].join("\n");
}
