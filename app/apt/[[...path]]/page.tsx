import type { Metadata } from "next";
import Link from "next/link";
import { stat } from "node:fs/promises";
import path from "node:path";
import { PACKAGES } from "@/lib/terminal/packages";
import { ME, SITE_URL } from "@/lib/site/me";

/**
 * apt 输出里 Get: 那一行的地址，浏览器打开就是这里。
 *
 * 长得像 Apache 的目录索引，因为真镜像就是 —— archive.ubuntu.com 底下
 * 没有任何前端，就是一个开着 autoindex 的 web 服务器。这里照抄那个样子，
 * 顺便让"下载是真的"这件事自己证明自己：文件真在 public/ 里躺着
 */

/** 镜像里的目录树，从包表推出来 —— 加一个包，这里的路径自己会长出来 */
function tree(): Map<string, string[]> {
  const dirs = new Map<string, string[]>();
  const add = (dir: string, entry: string) => {
    const list = dirs.get(dir) ?? [];
    if (!list.includes(entry)) list.push(entry);
    dirs.set(dir, list);
  };

  add("", "pool/");
  // 只有数据包在这个镜像里有文件；代码包的载荷是打包器切的 chunk
  for (const pkg of Object.values(PACKAGES)) {
    if (!pkg.path) continue;
    const segs = pkg.path.replace(/^\/apt\//, "").split("/");
    for (let i = 0; i < segs.length; i++) {
      const dir = segs.slice(0, i).join("/");
      add(dir, segs[i] + (i < segs.length - 1 ? "/" : ""));
    }
  }
  return dirs;
}

export function generateStaticParams() {
  return [...tree().keys()].map((p) => ({ path: p ? p.split("/") : [] }));
}

export const metadata: Metadata = {
  title: `${ME.host} archive`,
  robots: { index: false }, // 是个玩笑镜像，别让它进搜索结果
};

type Props = { params: Promise<{ path?: string[] }> };

/** 文件的真实大小和时间 —— 目录索引里那两列不该是编的 */
async function fileInfo(rel: string) {
  try {
    const s = await stat(path.join(process.cwd(), "public", "apt", rel));
    return {
      size: s.size,
      date: s.mtime.toISOString().slice(0, 16).replace("T", " "),
    };
  } catch {
    return null;
  }
}

export default async function AptIndex({ params }: Props) {
  const segs = (await params).path ?? [];
  const here = segs.join("/");
  const entries = tree().get(here) ?? [];

  const rows = await Promise.all(
    entries.map(async (name) => {
      const isDir = name.endsWith("/");
      const info = isDir ? null : await fileInfo(here ? `${here}/${name}` : name);
      return { name, isDir, info };
    })
  );

  // 顶层放一段 sources.list 片段，照抄镜像首页会放使用说明的习惯
  const readme = !here;

  return (
    <div className="prose autoindex">
      <h1>Index of /apt/{here && `${here}/`}</h1>
      <hr />
      <pre>
        {segs.length > 0 && (
          <>
            <a href={`/apt/${segs.slice(0, -1).join("/")}`}>../</a>
            {"\n"}
          </>
        )}
        {rows.map(({ name, info }) => {
          const href = `/apt/${here ? `${here}/` : ""}${name}`;
          return (
            <span key={name}>
              <a href={href}>{name}</a>
              {" ".repeat(Math.max(1, 40 - name.length))}
              {info ? `${info.date}   ${info.size}` : "-"}
              {"\n"}
            </span>
          );
        })}
      </pre>
      <hr />
      {readme && (
        <>
          <p className="dim">
            <span className="zh">
              这是 {ME.host} 的软件源。终端里 <code>sudo apt install figlet</code>{" "}
              下载的就是这底下的文件。
            </span>
            <span className="en">
              The {ME.host} archive. <code>sudo apt install figlet</code> in the terminal
              downloads from here.
            </span>
          </p>
          {/* 用规范化过的 SITE_URL，别在这里再解析一次环境变量 ——
              少写协议时 new URL 会抛 Invalid URL，而 Next 会把它报成别的路由的错 */}
          <pre>{`# /etc/apt/sources.list.d/${ME.host}.list
deb ${SITE_URL}/apt stable universe`}</pre>
        </>
      )}
      <p className="dim">
        <Link href="/">{ME.user}@{ME.host}</Link>
      </p>
    </div>
  );
}
