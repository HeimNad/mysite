// GitHub 资料 → 终端里的一页文本。纯函数，node --test 直接测。
//
// 数据是真的，但真的是"构建那一刻"的。所以最后一行写明抓取时间 ——
// 和版本号用 commit hash 一个道理：宁可说清楚它有多旧，也不含糊其辞。
//
// 抓取不在构建期做（见 scripts/gen-github.mjs）：GitHub 未认证接口是每小时
// 60 次、按 IP 算，CI 的 runner 共享出口 IP，放进构建迟早会撞限流把发布卡住

import { displayWidth, padCols } from "../terminal/text.ts";

export type GhProfile = {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  publicRepos: number;
  followers: number;
  createdAt: string;
};

export type GhRepo = {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  fork: boolean;
  pushedAt: string;
};

export type GhData = {
  profile: GhProfile;
  repos: GhRepo[];
  /** ISO 时间，抓取那一刻 */
  fetchedAt: string;
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * fork 不列。个人主页要看的是你写了什么，不是你 star 过什么 ——
 * 数量还是照实说，免得看着像把仓库藏起来了
 */
export function formatGithub(data: GhData): string {
  const { profile: p, repos } = data;
  const own = repos.filter((r) => !r.fork).sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  const forks = repos.length - own.length;

  const head = [
    p.name ?? p.login,
    ...(p.bio ? [p.bio] : []),
    [p.company, p.location, p.blog].filter(Boolean).join(" · "),
    "",
    `${p.publicRepos} public repos · ${p.followers} followers · joined ${day(p.createdAt)}`,
    "",
  ];

  if (!own.length) return [...head, "（还没有公开仓库）", "", footer(data)].join("\n");

  // 中文描述要按显示列数对齐，padEnd 会算错
  const nameW = Math.max(4, ...own.map((r) => displayWidth(r.name)));
  const langW = Math.max(8, ...own.map((r) => displayWidth(r.language ?? "—")));

  const rows = own.flatMap((r) => {
    const line =
      padCols(r.name, nameW + 2) +
      String(r.stars).padStart(5) +
      "  " +
      padCols(r.language ?? "—", langW + 2) +
      day(r.pushedAt);
    return r.description ? [line, "    " + r.description] : [line];
  });

  return [
    ...head,
    padCols("NAME", nameW + 2) + "STARS" + "  " + padCols("LANG", langW + 2) + "PUSHED",
    ...rows,
    "",
    ...(forks ? [`（另有 ${forks} 个 fork 没列出来 / ${forks} forks not listed）`, ""] : []),
    footer(data),
  ].join("\n");
}

/** 数据有多旧要说清楚：它停在构建那一刻，不会自己更新 */
function footer(data: GhData): string {
  return (
    `抓取于 ${day(data.fetchedAt)} · 数据来自 GitHub API，重新构建才会更新\n` +
    `Fetched ${day(data.fetchedAt)} · from the GitHub API; only a rebuild refreshes it`
  );
}
