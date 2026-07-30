import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev server 默认只允许 localhost 请求 /_next/* 资源，从手机用局域网 IP
  // 访问时所有 JS chunk 会返 403，页面只剩 SSR 的骨架。放开私有网段才能真机调试。
  // 按 . 分段匹配，* 通配一段。只影响 dev，生产环境无关。
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
};

export default nextConfig;
