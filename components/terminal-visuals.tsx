"use client";

import { useEffect, useState, type ReactNode } from "react";
import { donutFrame } from "@/lib/terminal/donut";
import avatarAscii from "@/components/avatar-ascii.json";

// 终端里那些不是纯文本的输出：命令返回一个标记，由这里认领渲染。
// 文字都在命令层算好（所以双语和防漏译的测试覆盖得到），这里只负责摆

const PALETTE = ["#f85149", "#39d353", "#ffd75f", "#58a6ff", "#bc8cff", "#39c5cf", "#c9d1d9"];

/** 文本里的 URL 和邮箱变成可点的链接 */
export function linkify(text: string): ReactNode {
  return text.split(/(https?:\/\/[^\s]+|[\w.]+@[\w.]+\.\w{2,})/g).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a>
    ) : /^[\w.]+@[\w.]+\.\w{2,}$/.test(p) ? (
      <a key={i} href={`mailto:${p}`}>{p}</a>
    ) : (
      p
    )
  );
}

/** 文字由 neofetch 命令算好传进来，这里只管把字符画和信息摆一起 */
export function Neofetch({ info }: { info: string[] }) {
  return (
    <div className="neofetch">
      <pre className="art">
        {avatarAscii.map((runs, y) => (
          <div key={y}>
            {runs.map((r, i) =>
              r.color ? (
                <span key={i} style={{ color: r.color }}>{r.text}</span>
              ) : (
                r.text
              )
            )}
          </div>
        ))}
      </pre>
      <pre className="info">
        {linkify(info.join("\n"))}
        {"\n\n"}
        {PALETTE.map((c) => (
          <span key={c} style={{ color: c }}>███</span>
        ))}
      </pre>
    </div>
  );
}

// 自己画的火车，不是原版 sl 的那张图。烟雾两帧交替
const SMOKE = [
  ["   (  ) (@@) ( )", "  (@@@)   (  )  ", " (   ) (@@@@)   "],
  ["  (@@) (  ) (@@)", " (   )  (@@@)   ", "(@@@@)  (   )   "],
];
const TRAIN = [
  "      _____",
  "  ___|[_]_|____________     ____________",
  " |             |  ___  |   |  __    __  |",
  " |   H E I M   | |[o]| |===|  ||    ||  |",
  " |_____________|_|___|_|   |____________|",
  "   (O)     (O)   (o) (o)     (o)    (o)",
];
const TRAIN_W = Math.max(...TRAIN.map((l) => l.length));
const TRACK_W = 78; // 经典终端宽度，够它开一段

/** sl：火车从右往左开过去，开完这块自己塌掉，输出流上不留空洞 */
export function Sl() {
  const [x, setX] = useState(TRACK_W);

  useEffect(() => {
    // 尊重系统的「减少动态效果」——静态摆一辆，别硬动
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setX((v) => v - 2), 55);
    return () => clearInterval(id);
  }, []);

  if (x <= -TRAIN_W) return null; // 开过去了

  const pad = (line: string) =>
    x >= 0 ? " ".repeat(x) + line : line.slice(-x);
  const smoke = SMOKE[Math.floor(x / 4) % 2 === 0 ? 0 : 1];

  return (
    <pre className="sl" aria-label="一列火车开了过去 / a train went by">
      {[...smoke.map((s) => "      " + s), ...TRAIN].map(pad).join("\n")}
    </pre>
  );
}

/** 甜甜圈：角度推进由这里管，每帧的形状是 donutFrame 算的。转一阵就停，别一直烧 CPU */
export function Donut() {
  const SPIN_MS = 12_000;
  // 不从 (0,0) 起：那个角度环面正好侧对着看，只剩一条窄带，当第一帧太空
  const [angle, setAngle] = useState({ a: 1.0, b: 0.5 });

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setAngle((v) => ({ a: v.a + 0.07, b: v.b + 0.03 })), 50);
    const stop = setTimeout(() => clearInterval(id), SPIN_MS);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, []);

  return (
    <pre className="sl" aria-label="一个旋转的甜甜圈 / a spinning donut">
      {donutFrame(angle.a, angle.b)}
    </pre>
  );
}
