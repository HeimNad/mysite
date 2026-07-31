import { toStatMap, toStatTree } from "@/lib/fs";
import { contentMtimes, readPosts, readRootfs } from "@/lib/content";

/**
 * 终端要的那三份数据。首页和 404 页都要，所以抽出来。
 * 全在构建期算完，客户端只拿目录结构，正文按需从 /api/fs 取
 */
export async function terminalProps() {
  const [root, posts, mtimes] = await Promise.all([
    readRootfs(),
    readPosts(),
    contentMtimes(),
  ]);
  return {
    root: toStatTree(root),
    posts: posts.map(({ slug, title, date, lang, tags }) => ({ slug, title, date, lang, tags })),
    // ls -l 要的大小和时间。正文不发给客户端，所以大小得单独带
    stats: toStatMap(root, mtimes, new Date().toISOString()),
  };
}
