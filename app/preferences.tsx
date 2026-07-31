import { PRIMARY_LANG } from "@/lib/site/me";

export const LANG_KEY = "lang";
export const THEME_KEY = "theme";

/**
 * 在任何东西渲染之前跑：把记住的语言和主题设到 <html> 上。
 *
 * 必须是同步内联脚本，不能是 React effect —— effect 在首帧之后才跑，
 * 会先闪一下默认样式（主题闪白、双语文案闪出两行）。这也是它不产生
 * hydration 不匹配的原因：它在 React 接手之前就把属性改完了。
 *
 * 静态页因此也能跟着走，而且不需要为此引入任何客户端组件
 */
export function PreferencesScript() {
  const script = `
try {
  var d = document.documentElement;
  var l = localStorage.getItem(${JSON.stringify(LANG_KEY)});
  if (l !== "zh" && l !== "en")
    l = (navigator.languages || [navigator.language]).some(function (x) {
      return String(x).toLowerCase().indexOf("zh") === 0;
    }) ? "zh" : "en";
  d.lang = l === "zh" ? "zh-CN" : "en";
  var t = localStorage.getItem(${JSON.stringify(THEME_KEY)});
  if (t) d.dataset.theme = t;
} catch (e) {}
`.trim();

  // 内容全部是本文件写死的字面量，没有任何外部输入
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/** 服务端渲染时的默认语言，和脚本没跑时保持一致 */
export const DEFAULT_HTML_LANG = PRIMARY_LANG === "zh" ? "zh-CN" : "en";
