import { HOME, toFileMap } from "@/lib/terminal/fs";
import { readRootfs } from "@/lib/content/content";

// 构建期生成。客户端登录后在后台取一次，把常用文件灌进缓存 ——
// 这样 cat 不用等一次往返，而首屏 HTML 又不必背着所有正文
export const dynamic = "force-static";

/** 文章不进包：它们是最大的，而且看文章有 open 和 /posts 两条更合适的路 */
const POSTS_PREFIX = [...HOME, "posts"].join("/") + "/";

export async function GET() {
  const all = toFileMap(await readRootfs());
  const warm = Object.fromEntries(
    Object.entries(all).filter(([path]) => !path.startsWith(POSTS_PREFIX))
  );
  return Response.json(warm);
}
