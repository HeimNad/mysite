// 把一个 3D 圆环渲染成字符。经典的 donut.c 路数：
// 参数化环面取点 → 绕两轴旋转 → 透视投影 → z-buffer 消隐 → 按亮度挑字符。
// 纯数学，不需要模型也不需要任何图形库，五十行的事
//
// 纯函数，给定角度输出永远一样 —— 所以 node --test 能验证它

/** 暗 → 亮。终端上这条比头像那条更适合表现曲面 */
const RAMP = ".,-~:;=!*#$@";

const R1 = 1; // 管子半径
const R2 = 2; // 圆心到管心
const K2 = 5; // 观察者距离

/** 圆环绕 X 轴转 a、绕 Z 轴转 b 之后的样子 */
export function donutFrame(a: number, b: number, cols = 48, rows = 24): string {
  const chars = new Array<string>(cols * rows).fill(" ");
  const zbuf = new Array<number>(cols * rows).fill(0);

  // 字符高约为宽的两倍，y 得压扁才不会渲染成椭圆
  const kx = (cols * K2 * 3) / (8 * (R1 + R2));
  const ky = kx * 0.45;

  const [cosA, sinA, cosB, sinB] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];

  // theta 绕管子一圈，phi 绕圆环一圈。步长够密才不会出现空洞
  for (let theta = 0; theta < Math.PI * 2; theta += 0.07) {
    const [cosT, sinT] = [Math.cos(theta), Math.sin(theta)];
    for (let phi = 0; phi < Math.PI * 2; phi += 0.02) {
      const [cosP, sinP] = [Math.cos(phi), Math.sin(phi)];

      const circleX = R2 + R1 * cosT;
      const circleY = R1 * sinT;

      const x = circleX * (cosB * cosP + sinA * sinB * sinP) - circleY * cosA * sinB;
      const y = circleX * (sinB * cosP - sinA * cosB * sinP) + circleY * cosA * cosB;
      const z = K2 + cosA * circleX * sinP + circleY * sinA;
      const ooz = 1 / z; // one over z，越大离得越近

      const xp = Math.round(cols / 2 + kx * ooz * x);
      const yp = Math.round(rows / 2 - ky * ooz * y);
      if (xp < 0 || xp >= cols || yp < 0 || yp >= rows) continue;

      // 表面法线和光照方向（0,1,-1）的点积。<= 0 是背面，不画
      const lum =
        cosP * cosT * sinB -
        cosA * cosT * sinP -
        sinA * sinT +
        cosB * (cosA * sinT - cosT * sinA * sinP);
      if (lum <= 0) continue;

      const i = xp + yp * cols;
      if (ooz > zbuf[i]) {
        zbuf[i] = ooz;
        chars[i] = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * 8))];
      }
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) lines.push(chars.slice(r * cols, (r + 1) * cols).join(""));
  return lines.join("\n");
}
