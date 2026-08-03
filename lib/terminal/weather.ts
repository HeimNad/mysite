// wttr.in 的 j1 响应 → 终端天气报告。纯函数：JSON 进，文本出，node --test 直接测。
//
// 这是全站唯一一处真的外部数据。取回来的 JSON 自己排版而不是用 wttr.in 的
// ASCII 输出，因为那个是按 User-Agent 门控的（浏览器拿到的是整页 HTML），
// 而且自己排版才能双语、才能测

/** 气象站的位置，不一定等于你输入的地名 —— 查 Tokyo 会落到式根島 */
export type Weather = {
  area: string;
  region: string;
  country: string;
  desc: string;
  code: number;
  tempC: number | null;
  feelsC: number | null;
  humidity: number | null;
  windKmph: number | null;
  windDir: string;
  pressure: number | null;
  uvIndex: number | null;
  observedAt: string;
  forecast: { date: string; maxC: number | null; minC: number | null }[];
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return typeof v === "string" && v !== "" && Number.isFinite(n) ? n : null;
};

/** wttr 的字段全是 [{ value: "..." }] 这种形状 */
const first = (v: unknown): string =>
  Array.isArray(v) && typeof (v[0] as { value?: unknown })?.value === "string"
    ? ((v[0] as { value: string }).value)
    : "";

export function parseWttr(text: string): Weather {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 地名查不到时 wttr 回的是 500 + 一行纯文本，不是 JSON
    throw new Error(text.trim().split("\n")[0] || "wttr: 返回的不是 JSON");
  }
  const d = raw as Record<string, unknown>;
  const cur = (d.current_condition as unknown[])?.[0] as Record<string, unknown> | undefined;
  const area = (d.nearest_area as unknown[])?.[0] as Record<string, unknown> | undefined;
  if (!cur) throw new Error("wttr: 响应里没有 current_condition");

  return {
    area: first(area?.areaName),
    region: first(area?.region),
    country: first(area?.country),
    desc: first(cur.weatherDesc),
    code: num(cur.weatherCode) ?? 0,
    tempC: num(cur.temp_C),
    feelsC: num(cur.FeelsLikeC),
    humidity: num(cur.humidity),
    windKmph: num(cur.windspeedKmph),
    windDir: typeof cur.winddir16Point === "string" ? cur.winddir16Point : "",
    pressure: num(cur.pressure),
    uvIndex: num(cur.uvIndex),
    observedAt: typeof cur.observation_time === "string" ? cur.observation_time : "",
    forecast: ((d.weather as unknown[]) ?? []).slice(0, 3).map((day) => {
      const w = day as Record<string, unknown>;
      return {
        date: typeof w.date === "string" ? w.date : "",
        maxC: num(w.maxtempC),
        minC: num(w.mintempC),
      };
    }),
  };
}

// WWO 的天气码分组。图案自己画的，比 wttr.in 那套窄一点，塞得进手机屏
const ART: Record<string, string[]> = {
  sun: ["  \\   /  ", "   .-.   ", "-- (   ) --", "   `-'   ", "  /   \\  "],
  partly: ["  \\  /   ", "_ /\"\".-.  ", "  \\_(   ). ", "  /(___(__)", "         "],
  cloud: ["         ", "    .--.  ", " .-(    ). ", "(___.__)__)", "         "],
  rain: ["    .-.   ", "   (   ). ", "  (___(__)", "  ' ' ' ' ", " ' ' ' '  "],
  snow: ["    .-.   ", "   (   ). ", "  (___(__)", "   *  *  *", "  *  *  * "],
  thunder: ["    .-.   ", "   (   ). ", "  (___(__)", "   ⚡'⚡'' ", "  ' ' ' ' "],
  fog: ["         ", " _ - _ - _ ", "  _ - _ - ", " _ - _ - _ ", "         "],
};

/** 天气码 → 图案。分组而不是逐码枚举 —— WWO 有几十个码，差别小于图案精度 */
export function artFor(code: number): string[] {
  if (code === 113) return ART.sun;
  if (code === 116) return ART.partly;
  if (code === 119 || code === 122) return ART.cloud;
  if (code === 143 || code === 248 || code === 260) return ART.fog;
  if ([200, 386, 389, 392, 395].includes(code)) return ART.thunder;
  const snow = [179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 350, 368, 371, 374, 377];
  if (snow.includes(code)) return ART.snow;
  return ART.rain;
}

const show = (n: number | null, unit = "") => (n === null ? "null" : `${n}${unit}`);

/**
 * byIp 由调用方给，不从响应里推：wttr.in 会把城市名先解析成经纬度，
 * 所以 request.type 永远是 LatLon，指定了城市也一样 —— 拿它判断会把
 * "查北京"说成"按你的 IP 定位"
 */
export function formatWeather(
  w: Weather,
  t: (zh: string, en: string) => string,
  byIp: boolean
): string {
  const place = [w.area, w.region, w.country].filter(Boolean).join(", ");
  const art = artFor(w.code);

  // 左边图案、右边数据，和 neofetch 一个排法
  const info = [
    w.desc,
    `${show(w.tempC, " °C")}` + (w.feelsC === null ? "" : t(`（体感 ${w.feelsC} °C）`, ` (feels ${w.feelsC} °C)`)),
    `${t("湿度", "Humidity")} ${show(w.humidity, "%")}   ${t("气压", "Pressure")} ${show(w.pressure, " hPa")}`,
    `${t("风", "Wind")} ${w.windDir} ${show(w.windKmph, " km/h")}   UV ${show(w.uvIndex)}`,
  ];
  const body = art.map((line, i) => line + "  " + (info[i] ?? "")).join("\n");

  const rows = w.forecast.map(
    (d) => `${d.date}   ${show(d.maxC, "°C").padStart(5)} / ${show(d.minC, "°C").padStart(5)}`
  );

  return [
    place + (byIp ? t("   （按你的 IP 定位）", "   (located from your IP)") : ""),
    "",
    body,
    "",
    t("日期           最高 /  最低", "Date            High /   Low"),
    ...rows,
    "",
    // 数据不是我的，说清楚它从哪来
    t(
      `观测于 ${w.observedAt} · 数据来自 wttr.in`,
      `Observed at ${w.observedAt} · data from wttr.in`
    ),
  ].join("\n");
}
