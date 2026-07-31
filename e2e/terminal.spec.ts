import { expect, test } from "@playwright/test";

// 这些路径只有真浏览器验证得了。之前每一个 UI bug 都出在这一层，
// 而 lib/ 的单测一个都覆盖不到
test.use({ locale: "zh-CN" });

const term = (page: import("@playwright/test").Page) => ({
  log: page.getByRole("log"),
  input: page.getByRole("textbox"),
});

async function boot(page: import("@playwright/test").Page) {
  await page.goto("/");
  const t = term(page);
  await expect(t.log).toContainText("欢迎来到");
  return t;
}

async function run(page: import("@playwright/test").Page, cmd: string) {
  const { input } = term(page);
  await input.fill(cmd);
  await input.press("Enter");
}

test("登录后输入框立刻可用 —— 别再被开场流程锁住", async ({ page }) => {
  const { input } = await boot(page);
  // 曾经这里是 disabled：开场动画没跑完，人就被永久锁在外面
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  await input.pressSequentially("whoami");
  await expect(input).toHaveValue("whoami");
});

test("登录横幅不该把 neofetch 一起糊出来", async ({ page }) => {
  const { log } = await boot(page);
  await expect(log).toContainText("System information as of");
  await expect(log).not.toContainText("GitHub:"); // neofetch 的字段，登录时不该出现
});

test("敲命令有输出，且输出和提示符都留在视口里", async ({ page }) => {
  const { log, input } = await boot(page);
  await run(page, "whoami");
  await expect(log).toContainText("heimnad");
  // 曾经的 bug：滚动把提示符顶到屏幕中间，输出被挤出视口
  await expect(input).toBeInViewport();
  await expect(log.getByText("heimnad", { exact: true }).last()).toBeInViewport();
});

test("管道真的串起来了", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "cat skills.txt | grep Language | wc -l");
  await expect(log).toContainText(/\s3$/m);
});

test("cat 走网络取内容也能出结果", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "cat about.txt");
  await expect(log).toContainText("你好，我是");
});

test("Tab 补全命令和路径", async ({ page }) => {
  const { input } = await boot(page);
  await input.pressSequentially("neo");
  await input.press("Tab");
  await expect(input).toHaveValue("neofetch ");

  await input.fill("cat ski");
  await input.press("Tab");
  await expect(input).toHaveValue("cat skills.txt ");
});

test("readline 键位：Ctrl+U 删到行首，Ctrl+A/E 移动光标", async ({ page }) => {
  const { input } = await boot(page);
  await input.pressSequentially("hello world");
  await input.press("Control+u");
  await expect(input).toHaveValue("");

  await input.pressSequentially("abc");
  await input.press("Control+a");
  await input.pressSequentially(">");
  await expect(input).toHaveValue(">abc");
  await input.press("Control+e");
  await input.pressSequentially("<");
  await expect(input).toHaveValue(">abc<");
});

test("↑ 能翻出上一条命令，刷新后仍在", async ({ page }) => {
  const { input } = await boot(page);
  await run(page, "pwd");
  await input.press("ArrowUp");
  await expect(input).toHaveValue("pwd");

  await page.reload();
  await expect(term(page).log).toContainText("欢迎来到");
  await term(page).input.press("ArrowUp");
  await expect(term(page).input).toHaveValue("pwd"); // 历史存进了 localStorage
});

test("别名 ll 出长格式，不是和 ls 一样", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "ll");
  await expect(log).toContainText("-r--r--r--");
  await expect(log).toContainText("total");
});

test("lang 切换会被记住", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "lang en");
  await expect(log).toContainText("Language switched to English.");

  await page.reload();
  await expect(term(page).log).toContainText("Welcome to FakeOS");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("open 会新开一个标签打开文章", async ({ page, context }) => {
  await boot(page);
  const popup = context.waitForEvent("page");
  await run(page, "open posts/why-a-terminal.md");
  const opened = await popup;
  await expect(opened).toHaveURL(/\/posts\/why-a-terminal$/);
});

test.describe("英文浏览器", () => {
  test.use({ locale: "en-US" });

  test("自动进英文，不需要先学会敲 lang", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("log")).toContainText("Welcome to FakeOS");
  });
});
