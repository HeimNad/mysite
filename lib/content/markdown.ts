// markdown → HTML，构建期跑完，文章页因此零客户端 JS
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeShiki, {
    theme: "github-dark",
    // 只加载用得到的语法，全量会让构建慢一大截
    langs: ["ts", "tsx", "js", "jsx", "bash", "python", "c", "json", "css", "html", "md"],
  })
  .use(rehypeStringify);

export async function renderMarkdown(md: string): Promise<string> {
  return String(await processor.process(md));
}
