// 从 assets/avatar.jpg 派生两样东西，都是构建期一次性的：
//   1. components/avatar-ascii.json —— neofetch 左边的彩色字符画
//   2. app/icon.png / app/apple-icon.png —— 圆形图标（Next 按约定自动接上）
// 换头像后重跑: npm run avatar [字符画列数]
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { ME } from "../lib/site/me.ts"; // Node 原生剥类型，不用把名字邮箱抄第二遍
import { escapeXml as esc } from "../lib/content/xml.ts";

const SRC = "assets/avatar.jpg";
const COLS = Number(process.argv[2]) || 40;
const RAMP = "@%#*+=-:. "; // 暗 → 亮

// ---------- 1. 字符画 ----------
const img = sharp(SRC);
const { width, height } = await img.metadata();
// 0.5：字符高约为宽的两倍，纵向压一半保持比例
const rows = Math.max(1, Math.round((height / width) * COLS * 0.5));
const { data } = await img
  .resize(COLS, rows, { fit: "fill" })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const out = [];
for (let y = 0; y < rows; y++) {
  const runs = [];
  for (let x = 0; x < COLS; x++) {
    const i = (y * COLS + x) * 4;
    let r = data[i], g = data[i + 1], b = data[i + 2];
    const a = data[i + 3];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);

    let ch = " ", color = "";
    // 近白且低饱和 → 当作背景留空
    if (a >= 128 && !(lum > 232 && sat < 26)) {
      ch = RAMP[Math.min(RAMP.length - 1, Math.floor((lum / 255) * RAMP.length))];
      // 提亮过暗像素，黑色线条在深色终端背景上才可见
      if (lum < 70) { r += 90; g += 90; b += 90; }
      // 量化颜色，合并相邻同色字符减少 span 数量
      color = `rgb(${r & ~15},${g & ~15},${b & ~15})`;
    }

    const last = runs[runs.length - 1];
    if (last && (last.color === color || ch === " ")) last.text += ch;
    else runs.push({ color, text: ch });
  }
  out.push(runs);
}

// 裁掉首尾全空行
const blank = (runs) => runs.every((r) => r.text.trim() === "");
while (out.length && blank(out[0])) out.shift();
while (out.length && blank(out[out.length - 1])) out.pop();

writeFileSync("components/avatar-ascii.json", JSON.stringify(out));
for (const runs of out) console.log(runs.map((r) => r.text).join(""));
console.log(`\n✓ components/avatar-ascii.json (${COLS}x${out.length})`);

// ---------- 2. 圆形图标 ----------
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// dest-in 遮罩：图标和 OG 头像的圆形裁剪用的是同一个形状，只是尺寸不同
const circleMask = (size) =>
  Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);

async function icon(size, dest) {
  const mask = circleMask(size);
  // 缩到圆的内接方形（≈0.707）再留一点边，否则耳朵和爪子会被圆周切掉。
  // trim 先去掉原图四周的纯白，猫才够大 —— 16px 下要认得出来
  const inner = Math.round(size * 0.68);
  const cat = await sharp(SRC)
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: "contain", background: WHITE })
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([
      { input: cat, gravity: "center" },
      { input: mask, blend: "dest-in" }, // 圆外变透明
    ])
    .png()
    .toFile(dest);
  console.log(`✓ ${dest} (${size}x${size})`);
}

await icon(512, "app/icon.png");
await icon(180, "app/apple-icon.png"); // iOS 加到主屏幕时用

// ---------- 3. OG 分享图 ----------
// 用 sharp 合成而不是 next/og：ImageResponse 底层的 Satori 不自带中日韩字体，
// 中文会渲染成方块。sharp 渲染 SVG 走系统字体，构建期出图，运行时零风险
async function ogImage(dest) {
  const [W, H] = [1200, 630];
  const AVATAR = 300;
  const CJK = "PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, sans-serif";
  const MONO = "SF Mono, Menlo, Consolas, monospace";

  const avatar = await sharp(SRC)
    .trim({ threshold: 10 })
    .resize(AVATAR, AVATAR, { fit: "contain", background: WHITE })
    .composite([{ input: circleMask(AVATAR), blend: "dest-in" }])
    .png()
    .toBuffer();

  const textX = 110 + AVATAR + 70;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <text x="${textX}" y="238" font-family="${MONO}" font-size="30" fill="#39d353">
    ${esc(`${ME.user}@${ME.host}:~$`)} <tspan fill="#8b949e">whoami</tspan>
  </text>
  <text x="${textX}" y="330" font-family="${esc(CJK)}" font-size="76" font-weight="700" fill="#f0f6fc">${esc(ME.name)}</text>
  <text x="${textX}" y="388" font-family="${esc(CJK)}" font-size="32" fill="#c9d1d9">${esc(ME.title.zh)}</text>
  <text x="${textX}" y="430" font-family="${MONO}" font-size="23" fill="#8b949e">${esc(ME.title.en)}</text>
  <text x="${textX}" y="486" font-family="${MONO}" font-size="24" fill="#58a6ff">${esc(ME.github.replace(/^https?:\/\//, ""))}</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: avatar, left: 110, top: (H - AVATAR) / 2 }])
    .png()
    .toFile(dest);
  console.log(`✓ ${dest} (${W}x${H})`);
}

await ogImage("app/opengraph-image.png");
