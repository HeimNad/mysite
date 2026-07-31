// 文档里提到的路径必须真的存在。
// 起因：重构之后 README 里的 lib/rootfs.ts 过期了整整一轮才被人眼发现
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const DOCS = ["README.md", "docs/architecture.md"];

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

test("README 不该重新长回架构长文", () => {
  const readme = readFileSync("README.md", "utf8");
  // 深层设计说明搬去了 docs/architecture.md，README 只留指路
  assert.match(readme, /docs\/architecture\.md/, "README 得指向架构文档");
  assert.ok(
    readme.length < 7000,
    `README 有 ${readme.length} 字符，太长了 —— 深层内容该进 docs/architecture.md`
  );
});
