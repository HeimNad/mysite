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

// /proc 读的是访客自己的浏览器。核数在哪儿都拿得到，内存只有 Chromium 系报 ——
// 所以这条要在两个引擎上分别验，不然"诚实降级"只是句口号
test("/proc 报的是这台浏览器的真实参数", async ({ page }) => {
  const { log } = await boot(page);
  // 断言最后一行而不是整个日志：toContainText 会折叠空白，^ 和 $ 匹配不到行首行尾
  const lastLine = log.locator(".line").last();

  await run(page, "ls /proc");
  await expect(log).toContainText("cpuinfo");

  // 核数：grep processor | wc -l 是真 Linux 的老把戏，这里也该成立
  await run(page, "grep processor /proc/cpuinfo | wc -l");
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  await expect(lastLine).toHaveText(String(cores));

  // uptime 第一个数真的在走，第二个浏览器不可能知道
  await run(page, "cat /proc/uptime");
  await expect(lastLine).toHaveText(/^\d+\.\d\d null$/);

  // df 的配额来自 storage.estimate，不是写死的
  await run(page, "df");
  const quota = await page.evaluate(async () => (await navigator.storage.estimate()).quota ?? 0);
  await expect(lastLine).toContainText(quota > 1024 ** 3 ? /\d(\.\d)?G/ : /\d(\.\d)?M/);
});

test("Safari 拿不到内存时写 null，不编数字", async () => {
  // 专门起 WebKit：Chromium 上这几个字段都有，测不到降级那条路
  const { webkit } = await import("@playwright/test");
  const browser = await webkit.launch();
  const page = await browser.newPage({ locale: "zh-CN" });
  try {
    await page.goto("http://localhost:3000/");
    const log = page.getByRole("log");
    await expect(log).toContainText("欢迎来到");

    // 先确认这个引擎确实不报这两个 —— 否则下面的断言等于没测
    const reports = await page.evaluate(() => ({
      deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory ?? null,
      perfMemory: (performance as { memory?: object }).memory ? true : null,
    }));
    expect(reports.deviceMemory, "WebKit 不该报 deviceMemory").toBeNull();
    expect(reports.perfMemory, "WebKit 不该报 performance.memory").toBeNull();

    const input = page.getByRole("textbox");
    const lastLine = log.locator(".line").last();
    const go = async (cmd: string) => {
      await input.fill(cmd);
      await input.press("Enter");
    };

    await go("free");
    await expect(lastLine).toContainText(/Mem:\s+null\s+null\s+null/);

    await go("cat /proc/meminfo");
    await expect(lastLine).toContainText(/MemTotal:\s+null/);
    // 关键：不能出现 0 kB 这种"看着像真的"的兜底值
    await expect(lastLine).not.toContainText("0 kB");

    // 但核数这一样 WebKit 是给的，必须是真数字而不是 null
    await go("grep processor /proc/cpuinfo | wc -l");
    const cores = await page.evaluate(() => navigator.hardwareConcurrency);
    expect(cores, "WebKit 该报核数").toBeGreaterThan(0);
    await expect(lastLine).toHaveText(String(cores));
  } finally {
    await browser.close();
  }
});

// ps/kill 的重点是"那个进程是真的"：列出来的是页面上真在跑的定时器，
// kill 之后动画当场停住。这条只有真浏览器验得了
test("ps 列的是真在跑的东西，kill 真的把它停掉", async ({ page }) => {
  const { log } = await boot(page);

  // 什么都没跑的时候只有 shell 自己
  await run(page, "ps");
  await expect(log).toContainText("hnsh");
  await expect(log).not.toContainText("donut");

  await run(page, "donut");
  const donut = log.locator("pre").last();
  await expect(donut).toContainText("$");

  // 现在它出现在进程表里了
  await run(page, "ps");
  await expect(log).toContainText("donut");

  // 取出 pid 再杀掉 —— 杀完形状必须定住
  const psText = await log.innerText();
  const pid = psText.match(/^\s*(\d+) pts\/0\s+\S+ donut$/m)?.[1];
  expect(pid, `ps 里没找到 donut 的 pid:\n${psText}`).toBeTruthy();

  await run(page, `kill ${pid}`);
  const frozen = await donut.textContent();
  await page.waitForTimeout(400);
  expect(await donut.textContent()).toBe(frozen);

  // 死了就不在表里了
  await run(page, "ps");
  const after = (await log.innerText()).split("PID TTY").pop()!;
  expect(after).not.toContain("donut");
});

test("kill 1 要 -9，而 -9 会把整台机器带走", async ({ page }) => {
  const { log } = await boot(page);

  await run(page, "kill 1");
  await expect(log).toContainText("不允许的操作");

  // 真 Linux 杀掉 init 就是内核 panic，这里对应 error.tsx
  await run(page, "kill -9 1");
  await expect(page.getByText("Segmentation fault (core dumped)")).toBeVisible();
  await page.getByRole("button", { name: /重启 shell/ }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
});

// apt 的全流程。装包是真下载，所以只有浏览器里跑得出来 ——
// 单测里 install 是个桩，验不了"那个地址真的存在"
test("sudo apt install figlet：真下载、真出现、刷新还在", async ({ page }) => {
  const { log, input } = await boot(page);

  // 没装之前：照抄 Ubuntu 的 command-not-found，它就是发现机制
  await run(page, "figlet hi");
  await expect(log).toContainText("Command 'figlet' not found");
  await expect(log).toContainText("sudo apt install figlet");

  // 不加 sudo 拿不到 dpkg 的锁
  await run(page, "apt install figlet");
  await expect(log).toContainText("are you root?");

  await run(page, "sudo apt install figlet");
  await expect(log).toContainText("Setting up figlet (2.2.5-3)");
  // Get: 那一行必须是真地址，而且字节数要和文件真实大小一致（30740 → 30.7 kB）
  await expect(log).toContainText("/apt/pool/universe/f/figlet/figlet_2.2.5-3.flf");
  await expect(log).toContainText("30.7 kB");

  await run(page, "figlet hi");
  await expect(log).toContainText("|_|");

  // 装完才进 Tab 补全
  await input.fill("figl");
  await input.press("Tab");
  await expect(input).toHaveValue("figlet ");

  // 刷新之后 dpkg 的记录还在，不用重装
  await page.reload();
  await expect(term(page).log).toContainText("欢迎来到");
  await run(page, "figlet ok");
  await expect(term(page).log).toContainText("|_|");
});

test("apt 输出里那个下载地址真能打开", async ({ page }) => {
  // 站上说"下载是真的"，那这个地址就必须真的在
  const res = await page.request.get("/apt/pool/universe/f/figlet/figlet_2.2.5-3.flf");
  expect(res.status()).toBe(200);
  expect((await res.body()).length).toBe(30740);

  // 镜像本身也能浏览，长得像 Apache 的目录索引
  await page.goto("/apt/pool/universe/f/figlet");
  await expect(page.getByRole("heading")).toContainText("Index of /apt/pool/universe/f/figlet/");
  await expect(page.getByRole("link", { name: "figlet_2.2.5-3.flf" })).toBeVisible();
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
