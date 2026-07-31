/**
 * XML 转义。RSS 和 OG 图（SVG 也是 XML）都要用 ——
 * 之前两处各写了一份，生成脚本那份漏了引号，值里出现 " 就会冲破属性
 */
export function escapeXml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}
