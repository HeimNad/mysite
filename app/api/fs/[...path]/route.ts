import { toFileMap } from "@/lib/fs";
import { readRootfs } from "@/lib/content";

// 构建期把每个文件生成成静态资源。运行时没有服务端代码在跑，
// 所以不存在的路径自然 404 —— 路径穿越无从下手
export const dynamic = "force-static";

async function fileMap() {
  return toFileMap(await readRootfs());
}

export async function generateStaticParams() {
  return Object.keys(await fileMap()).map((p) => ({ path: p.split("/") }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const content = (await fileMap())[path.join("/")];
  if (content === undefined) return new Response("Not found", { status: 404 });
  return new Response(content, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
