// 双语字符串。故意不用 key + 词条表的方案：
// 93 条串、2 种语言的规模下，t("cat.isDirectory") 那层间接只会让代码读不懂，
// 还会攒出没人敢删的孤儿 key。就地放 { zh, en } 对，译文和用它的地方永远不会走散
export type Lang = "zh" | "en";
export type Msg = { zh: string; en: string };

export const LANGS: Lang[] = ["zh", "en"];

export function pick(m: Msg, lang: Lang): string {
  return m[lang];
}

/** 浏览器语言 → 站点语言。认不出来的一律给英文 */
export function detectLang(navLangs: readonly string[]): Lang {
  return navLangs.some((l) => l.toLowerCase().startsWith("zh")) ? "zh" : "en";
}
