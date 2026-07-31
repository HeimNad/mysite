import { terminalProps } from "./terminal-data";
import Terminal from "@/components/terminal";

export const metadata = { title: "404" };

/**
 * 404 也是一个能用的终端。以前这里是一段静态文案加一个假光标 ——
 * 长得像输入框却敲不进去，而且只会说"你刚才输的那个路径"，不告诉你是哪个。
 * 现在报错带真实路径，提示符是真的
 */
export default async function NotFound() {
  return <Terminal {...(await terminalProps())} mode="notFound" />;
}
