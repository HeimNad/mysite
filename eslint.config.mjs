import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * lib/terminal 和 lib/site 必须能在浏览器和 node --test 里同样跑起来。
 * 目录只是表达意图，真正守住边界的是下面这两条规则。
 *
 * 分两条是因为它们拦的是两种东西：import 拦不住 window.localStorage，
 * 那是全局变量不是模块；globals 也拦不住 import "node:fs"
 */
const CROSS_RUNTIME_MESSAGE =
  "纯逻辑层不能依赖框架、Node 或浏览器环境。需要副作用就通过 Ctx 回调注入（见 lib/terminal/commands.ts）";

const crossRuntimeBoundary = {
  files: ["lib/terminal/**/*.ts", "lib/site/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        // 裸 next 也要拦，只写 next/* 会漏
        paths: [
          { name: "next", message: CROSS_RUNTIME_MESSAGE },
          { name: "react", message: CROSS_RUNTIME_MESSAGE },
          { name: "react-dom", message: CROSS_RUNTIME_MESSAGE },
        ],
        patterns: [
          { group: ["react/*", "react-dom/*", "next/*"], message: CROSS_RUNTIME_MESSAGE },
          { group: ["node:*"], message: CROSS_RUNTIME_MESSAGE },
          // 反向依赖：纯逻辑层不该知道 app 和 components 的存在
          { group: ["@/app/*", "@/components/*"], message: CROSS_RUNTIME_MESSAGE },
        ],
      },
    ],
    // performance 不在列表里：浏览器和 Node 都有，属于跨运行时
    "no-restricted-globals": [
      "error",
      ...["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "fetch", "alert", "XMLHttpRequest"].map(
        (name) => ({ name, message: CROSS_RUNTIME_MESSAGE })
      ),
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  crossRuntimeBoundary,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
