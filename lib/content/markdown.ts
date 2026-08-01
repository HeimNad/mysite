// markdown → HTML，构建期跑完，文章页因此零客户端 JS
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";

/**
 * 渲染结果直接进 dangerouslySetInnerHTML。原始 HTML 会被 remark-rehype 丢掉，
 * 但链接和图片的 URL 不经检查 —— [x](javascript:alert(1)) 会原样变成可点的 href。
 *
 * 内容是自己写的、构建期渲染的，所以这里选择当场抛而不是静默剥掉：
 * 和 interpolate 一样，构建期炸掉比把垃圾发出去好，也不用为此引入 sanitize 依赖
 */
const SAFE_URL = /^(?:https?:|mailto:|[./#])/i;
const URL_ATTRS = ["href", "src"] as const;

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function checkUrls(node: HastNode): void {
  for (const attr of URL_ATTRS) {
    const value = node.properties?.[attr];
    if (typeof value === "string" && value !== "" && !SAFE_URL.test(value))
      throw new Error(
        `<${node.tagName}> 的 ${attr} 用了不安全的 scheme: ${JSON.stringify(value)}。` +
          `只允许 http(s):、mailto:、以及 / . # 开头的相对地址`
      );
  }
  node.children?.forEach(checkUrls);
}

/** unified 按 unist Node 传树，这里只关心 hast 的那几个字段，收窄放在函数里 */
function assertSafeUrls() {
  return (tree: unknown) => checkUrls(tree as HastNode);
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(assertSafeUrls)
  .use(rehypeShiki, {
    theme: "github-dark",
    // 只加载用得到的语法，全量会让构建慢一大截
    langs: ["ts", "tsx", "js", "jsx", "bash", "python", "c", "json", "css", "html", "md"],
  })
  .use(rehypeStringify);

export async function renderMarkdown(md: string): Promise<string> {
  return String(await processor.process(md));
}
