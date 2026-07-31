// 读 content/ 目录。只在服务端跑（构建期）
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FSDir } from "../terminal/fs.ts";
import { ME, PRIMARY_LANG } from "../site/me.ts";
import { LANGS, type Lang } from "../site/i18n.ts";
import { mountRootfs } from "./rootfs.ts";

const CONTENT_DIR = path.join(process.cwd(), "content");
export const POSTS_DIR = path.join(CONTENT_DIR, "posts");

export type Post = {
  slug: string;
  title: string;
  /** 发表日期 YYYY-MM-DD。空字符串表示没写 */
  date: string;
  /** 最后更新日期，没写就是没更新过 */
  updated: string;
  description: string;
  /** 这篇文章用什么语言写的。没写就按站点主语言算 */
  lang: Lang;
  tags: string[];
  /** 这篇文章单独的 OG 图，相对路径或绝对 URL。没写就用站点那张 */
  image: string;
  /** true 的话不发布：生产构建里读不到它，dev 下能看见方便预览 */
  draft: boolean;
  body: string;
};

/**
 * {{email}} 之类的占位符从 ME 取值，这样邮箱只需要在 me.ts 改一次。
 * 双语字段要写清楚取哪边：{{title.zh}} / {{title.en}}。
 *
 * 取不到字符串就抛 —— 之前这里是 String(值)，ME.title 改成 { zh, en } 之后
 * 悄悄渲染成了 [object Object]。构建期炸掉比把垃圾发出去好
 */
function interpolate(text: string, where: string): string {
  return text.replace(/\{\{([\w.]+)\}\}/g, (whole, path: string) => {
    const [key, sub] = path.split(".");
    if (!(key in ME)) return whole; // 不认识的原样留着，可能本来就是正文

    const value = ME[key as keyof typeof ME];
    const picked: unknown = sub ? (value as Record<string, unknown>)?.[sub] : value;
    if (typeof picked === "string") return picked;

    throw new Error(
      `${where}: 占位符 ${whole} 取到的不是字符串（${typeof picked}）。` +
        `双语字段要写成 {{${key}.zh}} 或 {{${key}.en}}`
    );
  });
}

/**
 * 拆开开头的 YAML frontmatter。只认 key: value 单行 —— 博客要的
 * title/date/description 就这个形状，不值得为它引入一个 YAML 解析器
 */
export function parseFrontmatter(text: string): {
  meta: Record<string, string>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };

  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

/** 完整的假文件系统：content/ 挂在 /home/<user>，外面套一层 Linux 骨架 */
export async function readRootfs(): Promise<FSDir> {
  return mountRootfs(await readContent());
}

/**
 * content/ 里每个文件的真实修改时间，键是相对 content/ 的路径。
 * ls -l 用。rootfs 里那些生成出来的文件没有 mtime，由调用方退回构建时间
 */
export async function contentMtimes(
  dir = CONTENT_DIR,
  prefix: string[] = []
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === ".DS_Store") continue;
    const full = path.join(dir, e.name);
    const segs = [...prefix, e.name];
    if (e.isDirectory()) Object.assign(out, await contentMtimes(full, segs));
    else out[segs.join("/")] = (await stat(full)).mtime.toISOString();
  }
  return out;
}

/** content/ 目录本身：只要正文，frontmatter 在终端里显示没意义 */
export async function readContent(
  dir = CONTENT_DIR,
  prefix: string[] = []
): Promise<FSDir> {
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.name !== ".DS_Store") // macOS 的垃圾，别让它出现在 ls -a 里
    .sort((a, b) => a.name.localeCompare(b.name));

  const out: FSDir = {};
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const segs = [...prefix, e.name];
    out[e.name] = e.isDirectory()
      ? await readContent(full, segs)
      : interpolate(parseFrontmatter(await readFile(full, "utf8")).body, segs.join("/"));
  }
  return out;
}

/**
 * tags: rust, web  →  ["rust", "web"]
 * 解析器不认 YAML 数组，但人手滑写成 [a, b] 很常见，把方括号一并吃掉
 */
function parseTags(raw: string | undefined): string[] {
  return (raw ?? "")
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((t) => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** frontmatter 里的 true/yes/1 都算真 */
function parseBool(raw: string | undefined): boolean {
  return /^(true|yes|1)$/i.test(raw?.trim() ?? "");
}

/** 正文第一段当 description，用于 <meta> 和 OG */
function firstParagraph(body: string): string {
  const para = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("```"));
  const plain = (para ?? "").replace(/[*`_[\]]/g, "").replace(/\s+/g, " ");
  return plain.length > 150 ? plain.slice(0, 150) + "…" : plain;
}

async function readPost(file: string): Promise<Post> {
  const raw = await readFile(path.join(POSTS_DIR, file), "utf8");
  const { meta, body: rawBody } = parseFrontmatter(raw);
  const body = interpolate(rawBody, `posts/${file}`);
  const lang = meta.lang?.trim();
  return {
    slug: file.replace(/\.md$/, ""),
    // 没写 title 就退回正文第一个 # 标题，再退回文件名
    title: meta.title ?? /^#\s+(.+)$/m.exec(body)?.[1] ?? file.replace(/\.md$/, ""),
    date: meta.date ?? "",
    updated: meta.updated ?? "",
    description: meta.description ?? firstParagraph(body),
    lang: LANGS.includes(lang as Lang) ? (lang as Lang) : PRIMARY_LANG,
    tags: parseTags(meta.tags),
    image: meta.image ?? "",
    draft: parseBool(meta.draft),
    body,
  };
}

/**
 * 按日期倒序，没日期的排最后。同一天的按文件名排 ——
 * 否则顺序取决于 readdir，看着随机而且不可复现
 *
 * 草稿默认读不到。dev 下能看见，方便边写边预览
 */
export async function readPosts(opts: { drafts?: boolean } = {}): Promise<Post[]> {
  const withDrafts = opts.drafts ?? process.env.NODE_ENV === "development";
  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith(".md"));
  const all = await Promise.all(files.map(readPost));
  return all
    .filter((p) => withDrafts || !p.draft)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.slug.localeCompare(b.slug));
}

export async function getPost(slug: string): Promise<Post | null> {
  // 挡掉 ../ 之类的路径穿越 —— slug 来自 URL，是不可信输入
  if (!/^[\w-]+$/.test(slug)) return null;
  try {
    const post = await readPost(`${slug}.md`);
    // 草稿不能靠直接猜 URL 访问，否则 draft 等于没挡
    if (post.draft && process.env.NODE_ENV !== "development") return null;
    return post;
  } catch {
    return null;
  }
}
