import { defineConfig, devices } from "@playwright/test";

// 只测 UI 层 —— 命令层已经被 npm test 里那 48 个用例覆盖了。
// 这里管的是打字、补全、按键、滚动这些只有真浏览器才验证得了的东西
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 跑生产构建而不是 dev：dev 会按需编译路由，首次导航能慢到撞断言超时，
    // 于是同一条用例单独跑过、全量跑挂。顺便测的也是真正会上线的产物。
    // 本地已经开着 dev server 的话会直接复用它，不会白等一次构建
    command: "npm run build && npm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
