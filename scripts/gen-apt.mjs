// 把程序包编译成独立的 ES 模块，放进 public/apt/ 下面。
// 改了 vim.ts / htop.ts 之后重跑: npm run apt
//
// 为什么不用打包器自己切的 chunk：那个地址是 /_next/static/chunks/<哈希>.js，
// 而 apt 输出里 Get: 那一行应该指向软件源。跳转解决不了 —— import() 的地址
// 是构建期写死在产物里的，我们没有拦截点，摆一个跳转过去的假路径只会让
// 同样的字节下载两遍，日志好看而已。
//
// 所以让 /apt/ 成为真正的来源：模块编译到那儿，运行时 import 那个地址。
// 一次下载，地址是真的，浏览器和 curl 都打得开。
//
// 依赖会被打进包文件（htop 用到 elapsed/human/padCols 共约 35 行）——
// 真的 .deb 也是这样，小工具代码各自带一份
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { PACKAGES } from "../lib/terminal/packages.ts";

/** 包名 → 入口。只有程序包在这里，数据包（figlet 的字体）本来就是文件 */
const ENTRIES = {
  vim: "lib/terminal/vim.ts",
  htop: "lib/terminal/htop.ts",
};

for (const [name, entry] of Object.entries(ENTRIES)) {
  const pkg = PACKAGES[name];
  if (!pkg?.path) throw new Error(`packages.ts 里 ${name} 没登记 path`);

  const out = "public" + pkg.path;
  const result = await build({
    entryPoints: [entry],
    bundle: true, // 依赖打进来，浏览器只取一个文件
    format: "esm",
    target: "es2022", // 和 tsconfig 的 lib 对齐；Object.hasOwn 要 ES2022
    minify: true,
    write: false,
    outfile: out,
  });

  const code = result.outputFiles[0].text;
  writeFileSync(out, code);
  console.log(`✓ ${pkg.path}  ${new TextEncoder().encode(code).length} B`);
}
