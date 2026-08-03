// 从 GitHub API 抓一次资料，写成 content/github.txt。
// 换了用户名或者想刷新数据就重跑: npm run github
//
// 为什么不在构建期抓：GitHub 未认证接口是每小时 60 次、按 IP 算，而 CI 的
// runner 共享出口 IP —— 放进构建就等于让别人的用量决定我能不能发布。
// 和 npm run avatar 一样：显式跑一次，产物提交进仓库，构建只读文件
import { writeFileSync } from "node:fs";
import { ME } from "../lib/site/me.ts";
import { formatGithub } from "../lib/content/github.ts";

const OUT = "content/github.txt";
const user = new URL(ME.github).pathname.replace(/^\//, "");
if (!/^[\w-]+$/.test(user)) throw new Error(`me.ts 里的 github 不像用户主页: ${ME.github}`);

const api = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": user },
  });
  if (!res.ok) {
    const hint =
      res.status === 403
        ? "（多半是撞了每小时 60 次的未认证限流，等一会儿再跑）"
        : "";
    throw new Error(`GitHub API ${res.status} ${res.statusText} ${hint}`);
  }
  return res.json();
};

const [p, repos] = await Promise.all([
  api(`/users/${user}`),
  api(`/users/${user}/repos?sort=pushed&per_page=100`),
]);

const text = formatGithub({
  profile: {
    login: p.login,
    name: p.name,
    bio: p.bio,
    company: p.company,
    location: p.location,
    blog: p.blog || null,
    publicRepos: p.public_repos,
    followers: p.followers,
    createdAt: p.created_at,
  },
  repos: repos.map((r) => ({
    name: r.name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    fork: r.fork,
    pushedAt: r.pushed_at,
  })),
  fetchedAt: new Date().toISOString(),
});

writeFileSync(OUT, text + "\n");
console.log(text);
console.log(`\n✓ ${OUT}（${repos.length} 个仓库）`);
