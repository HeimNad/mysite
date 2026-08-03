// wttr 的解析和排版。夹具是 wttr.in 真实响应删减来的（去掉了没用到的 hourly），
// 不是我照着字段名编的 —— 编出来的夹具只能证明解析器自洽，证不了它对得上真接口
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execute } from "../lib/terminal/shell.ts";
import { artFor, formatWeather, parseWttr } from "../lib/terminal/weather.ts";
import { at, ctxOf, ROOT } from "./fixtures.mts";

const REAL = await readFile("tests/fixtures/wttr-j1.json", "utf8");
const t = (zh: string) => zh;

test("解析真实响应", () => {
  const w = parseWttr(REAL);
  assert.equal(w.area, "East Kamias");
  assert.equal(w.country, "Philippines");
  assert.equal(w.tempC, 24);
  assert.equal(w.feelsC, 28);
  assert.equal(w.humidity, 95);
  assert.equal(w.desc, "Light rain shower");
  assert.equal(w.forecast.length, 3, "j1 给三天");
  assert.equal(w.forecast[0].maxC, 26);
});

test("「按 IP 定位」只在真没给城市时才说", () => {
  // 曾经拿响应里的 request.type === "LatLon" 判断，结果 wttr.in 会先把
  // 城市名解析成经纬度，指定了 Beijing 那个值也是 LatLon —— 于是
  // "查北京"被说成"按你的 IP 定位"。判断只能来自"用户给没给城市"
  const w = parseWttr(REAL);
  assert.match(formatWeather(w, t, true), /按你的 IP 定位/);
  assert.doesNotMatch(formatWeather(w, t, false), /按你的 IP 定位/);
});

test("排版里该有的都在，而且说清楚数据来自哪", () => {
  const text = formatWeather(parseWttr(REAL), t, true);
  assert.match(text, /East Kamias, Quezon City, Philippines/);
  assert.match(text, /按你的 IP 定位/, "按 IP 定位要标出来");
  assert.match(text, /24 °C/);
  assert.match(text, /体感 28 °C/);
  assert.match(text, /wttr\.in/, "数据不是我的，得写明出处");
  assert.match(text, /2026-08-03/, "预报日期");
});

test("字段缺失时写 null，不写 0", () => {
  const holes = JSON.parse(REAL);
  delete holes.current_condition[0].humidity;
  delete holes.current_condition[0].pressure;
  const w = parseWttr(JSON.stringify(holes));
  assert.equal(w.humidity, null);
  assert.equal(w.pressure, null);
  const text = formatWeather(w, t, true);
  assert.match(text, /湿度 null/);
  assert.doesNotMatch(text, /湿度 0%/, "别拿 0 冒充拿不到");
});

test("地名查不到时原样转达 wttr 的话，不自己编", () => {
  // 真实响应：HTTP 500 + 这一行纯文本
  assert.throws(() => parseWttr("location not found: location not found"), /location not found/);
  assert.throws(() => parseWttr("<!DOCTYPE html>"), /DOCTYPE|不是 JSON/);
  assert.throws(() => parseWttr("{}"), /current_condition/);
});

test("天气码分组：晴雨雪雷各有各的图", () => {
  const uniq = new Set([113, 116, 119, 143, 200, 338, 296].map((c) => artFor(c).join("")));
  assert.equal(uniq.size, 7, "这七类不该撞图");
  // 认不出的码退回下雨，不该崩
  assert.ok(artFor(99999).length > 0);
});

test("wttr 命令：两种失败分得开", async () => {
  const base = ctxOf(ROOT, at());

  // 请求根本没发出去（断网、CORS 被拦）
  const offline = { ...base, http: async () => { throw new Error("Failed to fetch"); } };
  assert.match((await execute("wttr Beijing", offline)).error!, /没能拿到 Beijing/);

  // 请求成功但对方回的不是天气 —— 原样转达 wttr 的话，别自己编
  const notFound = { ...base, http: async () => "location not found: location not found" };
  assert.match((await execute("wttr nowhere", notFound)).error!, /location not found/);

  const good = { ...base, http: async () => REAL };
  const ok = await execute("wttr", good);
  assert.equal(ok.error, undefined, `意外报错: ${ok.error}`);
  assert.match(ok.output as string, /East Kamias/);
});

test("wttr 请求的是 j1，城市名要转义", async () => {
  let asked = "";
  const ctx = { ...ctxOf(ROOT, at()), http: async (u: string) => { asked = u; return REAL; } };
  await execute("wttr New York", ctx);
  assert.match(asked, /^https:\/\/wttr\.in\/New%20York\?format=j1$/);
});
