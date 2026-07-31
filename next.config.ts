import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * 版本号 = 这份代码的 commit hash。比手写 0.x 诚实：它精确对应正在跑的东西，
 * 别人还能拿去仓库里对。工作区有未提交的改动就加 -dirty，别谎报。
 * 只在构建期算一次，通过 env 烘进客户端产物
 */
function buildVersion(): string {
  // Vercel 上没有 .git，但它给了这个环境变量
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);
  try {
    const sha = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown"; // 不在 git 仓库里（比如别人下载了 zip）
  }
}

const nextConfig: NextConfig = {
  // dev server 默认只允许 localhost 请求 /_next/* 资源，从手机用局域网 IP
  // 访问时所有 JS chunk 会返 403，页面只剩 SSR 的骨架。放开私有网段才能真机调试。
  // 按 . 分段匹配，* 通配一段。只影响 dev，生产环境无关。
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  env: { NEXT_PUBLIC_BUILD_VERSION: buildVersion() },
};

export default nextConfig;
