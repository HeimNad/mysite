"use client";

import { useEffect } from "react";
import { ME } from "@/lib/me";

/**
 * 终端就是全站，所以它一旦抛异常整页就白了。
 * 这里兜住，顺便让崩溃也符合设定。静态渲染拿不到客户端语言，两种都写
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div id="terminal">
      <div className="line">
        <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>
        mysite-sh
      </div>
      <div className="line err">Segmentation fault (core dumped)</div>
      <div className="line">
        {"\n"}这台机器崩了。不是你的错 —— 是我的。
      </div>
      <div className="line dim">
        Something crashed. That is on me, not you.
      </div>
      {error.digest && <div className="line dim">{`\ncore dumped to: ${error.digest}`}</div>}
      <div className="line">
        {"\n  "}
        <button type="button" className="linkish" onClick={reset}>
          重启 shell / restart the shell
        </button>
      </div>
      <div className="line">
        {"  "}
        {/* 故意用 <a> 而不是 <Link>：崩溃现场的客户端路由本身可能就是坏的那部分，
            硬跳转是唯一能确保走得动的方式 */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/posts">/posts</a>
        {"      文章还在 / the articles still work"}
      </div>
      <div className="input-line">
        <span className="prompt">{`${ME.user}@${ME.host}:~$ `}</span>
        <span className="cursor" aria-hidden />
      </div>
    </div>
  );
}
