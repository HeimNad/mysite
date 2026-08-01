// 文档里提到的路径必须真的存在。
// 起因：重构之后 README 里的 lib/rootfs.ts 过期了整整一轮才被人眼发现
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DOCS = ["README.md", "docs/architecture.md", "docs/customizing.md"];

/**
 * 只检查带 / 的路径：`about.txt` 这种裸文件名在文中是省略写法，
 * 而 `next/og` 之类的包名没有扩展名，不会匹配上
 */
function pathsIn(markdown: string): string[] {
  const inCode = [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [
    ...new Set(
      inCode.filter(
        (s) =>
          /^[a-z][\w.-]*(\/[\w.*-]+)+\.\w+$/.test(s) && // 形如 a/b.ts
          !s.includes("*") && // 通配符跳过
          !s.startsWith("@")
      )
    ),
  ];
}

for (const doc of DOCS) {
  test(`${doc} 里的路径都存在`, () => {
    const found = pathsIn(readFileSync(doc, "utf8"));
    assert.ok(found.length > 0, `${doc} 里一个路径都没匹配到，正则可能失效了`);
    for (const p of found) assert.ok(existsSync(p), `${doc} 提到的 ${p} 不存在`);
  });
}

test("README 只做介绍和指路，细节留在 docs/", () => {
  const readme = readFileSync("README.md", "utf8");
  // 定制细节在 docs/customizing.md，设计决策在 docs/architecture.md，
  // README 只负责"这是什么"和"从哪进去"
  assert.match(readme, /docs\/customizing\.md/, "README 得指向定制文档");
  assert.match(readme, /docs\/architecture\.md/, "README 得指向架构文档");

  // 上限跟着实际长度收紧过一次：留太多余量它就拦不住任何东西
  assert.ok(
    readme.length < 5500,
    `README 有 ${readme.length} 字符，太长了 —— 细节该进 docs/`
  );
});
