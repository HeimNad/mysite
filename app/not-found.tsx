import Link from "next/link";
import { ME } from "@/lib/me";

export const metadata = { title: "404" };

// 静态页，拿不到客户端语言，所以两种语言都写上 —— 一个 404 显示两行不算问题
export default function NotFound() {
  return (
    <div id="terminal">
      <div className="line">
        <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>
        cd 你刚才输的那个路径
      </div>
      <div className="line err">bash: cd: 没有那个文件或目录</div>
      <div className="line err">bash: cd: No such file or directory</div>
      <div className="line">
        {"\n"}这个路径不存在（HTTP 404）。可能是打错了，也可能是我把它删了。
      </div>
      <div className="line dim">
        This path does not exist. Either a typo, or I deleted it.
      </div>
      <div className="line dim">{"\n"}存在的地方 / what does exist:</div>
      <div className="line">
        {"  "}
        <Link href="/">/</Link>
        {"           回到终端 / back to the terminal"}
      </div>
      <div className="line">
        {"  "}
        <Link href="/posts">/posts</Link>
        {"      所有文章 / all articles"}
      </div>
      <div className="input-line">
        <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>
        <span className="cursor" aria-hidden />
      </div>
    </div>
  );
}
