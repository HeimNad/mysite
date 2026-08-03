// GitHub 资料页的排版。夹具是 api.github.com 的真实响应删减来的，
// 不是照着字段名编的 —— 编出来的只能证明格式化器自洽，证不了它对得上真接口
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatGithub, type GhData } from "../lib/content/github.ts";
import { displayWidth } from "../lib/terminal/text.ts";

const raw = JSON.parse(await readFile("tests/fixtures/github.json", "utf8"));
const DATA: GhData = {
  profile: {
    login: raw.profile.login,
    name: raw.profile.name,
    bio: raw.profile.bio,
    company: raw.profile.company,
    location: raw.profile.location,
    blog: raw.profile.blog || null,
    publicRepos: raw.profile.public_repos,
    followers: raw.profile.followers,
    createdAt: raw.profile.created_at,
  },
  repos: raw.repos.map((r: Record<string, unknown>) => ({
    name: r.name as string,
    description: r.description as string | null,
    language: r.language as string | null,
    stars: r.stargazers_count as number,
    fork: r.fork as boolean,
    pushedAt: r.pushed_at as string,
  })),
  fetchedAt: "2026-08-03T00:00:00.000Z",
};

test("资料头部用真实字段", () => {
  const t = formatGithub(DATA);
  assert.match(t, /HeimNad/);
  assert.match(t, /Let go of things you can't change\./);
  assert.match(t, /SkyWorldStudio · United States/);
  assert.match(t, /6 public repos · 5 followers · joined 2022-06-18/);
});

test("fork 不列，但数量照实说 —— 不能看着像把仓库藏了", () => {
  const t = formatGithub(DATA);
  assert.doesNotMatch(t, /Midsoul/, "Midsoul 是 fork");
  assert.match(t, /另有 2 个 fork/);
  assert.match(t, /Spigot_Autobuild/, "自己的仓库要列出来");
});

test("按最近推送排序", () => {
  const t = formatGithub(DATA);
  const order = ["mysite", "TheMNHWebsite", "Spigot_Autobuild"].map((n) => t.indexOf(n));
  assert.ok(order.every((i) => i > 0), "这几个都该出现");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "顺序要按推送时间倒序");
});

test("中文仓库名不会把列排歪", () => {
  // 夹具里的仓库名全是 ASCII，测不到这条 —— 掺一个中文名进去才测得到，
  // 因为 padEnd 按 UTF-16 码元算，中文会短一半
  const t = formatGithub({
    ...DATA,
    repos: [
      { name: "我的地图包", description: null, language: "Java", stars: 1, fork: false, pushedAt: "2026-08-01T00:00:00Z" },
      { name: "mysite", description: null, language: "TypeScript", stars: 0, fork: false, pushedAt: "2026-07-01T00:00:00Z" },
    ],
  });
  // 只取表头之后的仓库行 —— "joined 2022-06-18" 也以日期结尾，别把它算进来
  const all = t.split("\n");
  const from = all.findIndex((l) => l.startsWith("NAME")) + 1;
  const rows = all.slice(from, all.indexOf("", from));
  assert.equal(rows.length, 2, `取到的行不对:\n${rows.join("\n")}`);
  // 日期都在同一个显示列上开始，才算真对齐
  const cols = rows.map((l) => displayWidth(l.slice(0, l.length - 10)));
  assert.equal(cols[0], cols[1], `列没对齐:\n${rows.join("\n")}`);
});

test("说清楚数据停在哪一刻 —— 它不会自己更新", () => {
  const t = formatGithub(DATA);
  assert.match(t, /抓取于 2026-08-03/);
  assert.match(t, /重新构建才会更新/);
  assert.match(t, /only a rebuild refreshes it/);
});

test("字段为空时不崩，也不印 null", () => {
  const bare = formatGithub({
    profile: {
      login: "x", name: null, bio: null, company: null, location: null,
      blog: null, publicRepos: 0, followers: 0, createdAt: "2020-01-01T00:00:00Z",
    },
    repos: [],
    fetchedAt: "2026-08-03T00:00:00.000Z",
  });
  assert.match(bare, /^x$/m, "没填 name 就用 login");
  assert.match(bare, /还没有公开仓库/);
  assert.doesNotMatch(bare, /\bnull\b/, "空字段不该印成 null");
});

test("生成的 content/github.txt 和格式化器输出一致", async () => {
  // 手改过那个文件、或者格式化器改了没重跑 npm run github，这条会红
  const onDisk = await readFile("content/github.txt", "utf8");
  assert.match(onDisk, /抓取于 \d{4}-\d{2}-\d{2}/);
  assert.match(onDisk, /public repos · \d+ followers/);
});
