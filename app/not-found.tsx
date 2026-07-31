import Link from "next/link";
import { ME } from "@/lib/me";

export const metadata = { title: "404" };

// 静态页，拿不到客户端语言，所以两种语言都写上 —— 一个 404 显示两行不算问题
export default function NotFound() {
  return (
    <div id="terminal">
      <div className="line">
        <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>
        <span className="zh">cd 你刚才输的那个路径</span>
        <span className="en">cd whatever-you-typed</span>
      </div>
      <div className="line err">
        <span className="zh">bash: cd: 没有那个文件或目录</span>
        <span className="en">bash: cd: No such file or directory</span>
      </div>
      <div className="line">
        <span className="zh">{"\n"}这个路径不存在（HTTP 404）。可能是打错了，也可能是我把它删了。</span>
        <span className="en">{"\n"}This path does not exist. Either a typo, or I deleted it.</span>
      </div>
      <div className="line dim">
        <span className="zh">{"\n"}存在的地方:</span>
        <span className="en">{"\n"}What does exist:</span>
      </div>
      <div className="line">
        {"  "}
        <Link href="/">/</Link>
        <span className="zh">{"           回到终端"}</span>
        <span className="en">{"           back to the terminal"}</span>
      </div>
      <div className="line">
        {"  "}
        <Link href="/posts">/posts</Link>
        <span className="zh">{"      所有文章"}</span>
        <span className="en">{"      all articles"}</span>
      </div>
      <div className="input-line">
        <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>
        <span className="cursor" aria-hidden />
      </div>
    </div>
  );
}
