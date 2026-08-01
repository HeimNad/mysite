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

test("donut 真的在转，不是一张静态图", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "donut");

  const donut = log.locator("pre").last();
  await expect(donut).toContainText("$");
  const first = await donut.textContent();

  // 隔几帧再看，形状必须变了 —— 只断言"画出来了"是测不到动画的
  await page.waitForTimeout(400);
  expect(await donut.textContent()).not.toBe(first);
});

test("语言选择会带到静态页上", async ({ page }) => {
  await boot(page);
  await run(page, "lang en");
  await expect(term(page).log).toContainText("Language switched");

  // 文章列表是静态页，以前中英并排 —— 现在跟着 <html lang> 只显示一种
  await page.goto("/posts");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // toHaveText 读的是 textContent，隐藏元素也算进去 —— 得直接断可见性
  await expect(page.locator("h1 .en")).toBeVisible();
  await expect(page.locator("h1 .zh")).toBeHidden();

  // 但两种语言都得留在 HTML 里，爬虫和禁用 JS 的人才看得到
  await expect(page.locator("h1 .zh")).toHaveText("文章");
});

test("主题跨页面和刷新都保持住", async ({ page }) => {
  const html = page.locator("html");
  await boot(page);
  await expect(html).not.toHaveAttribute("data-theme", "amber");

  await run(page, "theme");
  await expect(html).toHaveAttribute("data-theme", "amber");

  // 以前 toggleTheme 只改 DOM 不存盘，刷新和跳页都会丢
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "amber");
  await page.goto("/posts");
  await expect(html).toHaveAttribute("data-theme", "amber");
});

test("404 报出真实路径，而且那个提示符是真能用的", async ({ page }) => {
  await page.goto("/some/made-up/path");
  const { log, input } = term(page);

  // 以前只说"你刚才输的那个路径"，不告诉你是哪个
  await expect(log).toContainText("/some/made-up/path");
  await expect(log).toContainText("没有那个文件或目录");

  // 以前底下是个假光标，长得像输入框但敲不进去
  await expect(input).toBeEnabled();
  await run(page, "whoami");
  await expect(log).toContainText("heimnad");

  // 网络请求那条路也得通（cat 要去 /api/fs 取内容）
  await run(page, "cat about.txt");
  await expect(log).toContainText("你好，我是");
});

// 中文输入法打拼音时，回车是"选词"、↑↓ 是"翻候选词"，都不该被终端抢走。
// 这层只有真浏览器测得了：keydown 的 isComposing 是浏览器给的
test("输入法组合期间的回车和方向键归输入法，不归终端", async ({ page }) => {
  const { log, input } = await boot(page);
  await run(page, "pwd"); // 先留一条历史，好验证 ↑ 没被抢走

  const compose = (key: string) =>
    input.evaluate((el, k) => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, isComposing: true, bubbles: true })
      );
    }, key);

  await input.fill("nihao"); // 还没选词的拼音
  await compose("Enter");
  await expect(input, "组合中的回车不该清空输入").toHaveValue("nihao");
  await expect(log).not.toContainText("nihao: 未找到命令");

  await compose("ArrowUp");
  await expect(input, "组合中的 ↑ 是翻候选词，不该翻出历史").toHaveValue("nihao");

  // 组合结束后一切照旧
  await input.fill("whoami");
  await input.press("Enter");
  await expect(log).toContainText("heimnad");
});

test("草稿在生产构建里连终端也看不见", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "ls posts");
  await expect(log).toContainText("why-a-terminal.md");
  await expect(log).not.toContainText("_draft");

  // 直接 cat 也不行 —— 文件根本不在树里
  await run(page, "cat posts/_draft-example.md");
  await expect(log).toContainText("没有那个文件或目录");
});

test.describe("英文浏览器", () => {
  test.use({ locale: "en-US" });

  test("自动进英文，不需要先学会敲 lang", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("log")).toContainText("Welcome to FakeOS");
  });
});
