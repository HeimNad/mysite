import { devices, expect, test } from "@playwright/test";

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

  // 四条一串：cut 取字段、sort 排序、uniq -c 数个数。
  // uniq 只合并相邻的，所以中间那个 sort 不是装饰
  await run(page, "cat skills.txt | cut -d: -f1 | sort | uniq -c");
  const last = log.locator(".line").last();
  await expect(last).toContainText("3 Language");
  await expect(last).toContainText("2 Tool");
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

test("!! 重跑上一条，回显的是展开后的命令", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "whoami");
  await run(page, "!!");
  // 回显必须是 whoami 而不是 !!，因为真正跑的是它
  await expect(log.locator(".line").nth(-2)).toContainText("whoami");
  await expect(log.locator(".line").last()).toHaveText("heimnad");

  // 展开不了的要报错，而且不能进历史
  await run(page, "!nosuch");
  await expect(log).toContainText("event not found");
  await term(page).input.press("ArrowUp");
  await expect(term(page).input, "失败的展开不该留在历史里").toHaveValue("whoami");
});

test("Ctrl+R 反向搜索：边打边找，回车执行命中的那条", async ({ page }) => {
  const { log, input } = await boot(page);
  await run(page, "cat about.txt");
  await run(page, "pwd");
  await run(page, "cat skills.txt");

  await input.press("Control+r");
  await expect(page.locator(".prompt").last()).toContainText("(reverse-i-search)");

  await page.keyboard.type("cat");
  const shown = page.locator(".rsearch");
  await expect(shown, "先命中最近那条 cat").toContainText("cat skills.txt");

  // 再按一次往更早找
  await input.press("Control+r");
  await expect(shown).toContainText("cat about.txt");

  await input.press("Enter");
  // 断言要能区分跑的是哪一条 —— "Language" 两个文件里都有，等于没测。
  // 这句只在 about.txt 里
  await expect(log.locator(".line").last()).toContainText("你好，我是");
  await expect(input, "执行完搜索词要清掉").toHaveValue("");
  await expect(page.locator(".rsearch")).toHaveCount(0);
});

test("Ctrl+R 按 Esc 放弃，命令行还原成空", async ({ page }) => {
  const { input } = await boot(page);
  await run(page, "whoami");

  await input.press("Control+r");
  await page.keyboard.type("who");
  await expect(page.locator(".rsearch")).toContainText("whoami");

  await input.press("Escape");
  await expect(page.locator(".rsearch")).toHaveCount(0);
  await expect(input).toHaveValue("");
  await expect(page.locator(".prompt").last()).toContainText("heimnad@web");
});

test("github.txt 是构建期抓的真数据，并说明了它有多旧", async ({ page }) => {
  const { log } = await boot(page);
  await run(page, "cat github.txt");
  await expect(log).toContainText("public repos");
  // 数据停在构建那一刻，这件事必须写在页面上而不是只写在文档里
  await expect(log).toContainText("重新构建才会更新");
  // 走的是普通内容管线，所以 ls 和管道都白拿
  await run(page, "cat github.txt | grep followers | wc -l");
  await expect(log.locator(".line").last()).toHaveText("1");
});

// vim 的状态机单测全覆盖了。这里只验浏览器才验得了的：键盘归它、
// 输入法能打中文、光标是真画出来的
test.describe("vim", () => {
  test.use({ viewport: { width: 900, height: 400 } });

  test("手机上出得来 —— 软键盘没有 Esc，屏幕上必须有", async ({ browser }) => {
    // iOS 的软键盘没有 Esc 键。没有屏幕按键栏的话，进了插入模式就只能刷新页面，
    // 和当初 disabled 把人锁在输入框外面是同一类问题
    const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
    const page = await ctx.newPage();
    try {
      await page.goto("/");
      const input = page.getByRole("textbox");
      await expect(page.getByRole("log")).toContainText("欢迎来到");
      await input.fill("vim skills.txt");
      await input.press("Enter");

      const status = page.locator(".vim-status");
      await expect(status).toBeVisible();
      await page.keyboard.press("i");
      await expect(status).toContainText("-- INSERT --");

      // 关键：屏幕上得有一个能点的 Esc
      const esc = page.getByRole("button", { name: "Esc" });
      await expect(esc, "手机上必须有可点的 Esc，否则出不来").toBeVisible();
      await esc.click();
      await expect(status).not.toContainText("-- INSERT --");

      // 点完还能继续操作，说明焦点没被按钮抢走
      await page.keyboard.type(":q!");
      await page.keyboard.press("Enter");
      await expect(status).toBeHidden();
    } finally {
      await ctx.close();
    }
  });

  test("vim 是整屏接管：看不到历史，退出后原样恢复", async ({ page }) => {
    const { log } = await boot(page);
    await run(page, "neofetch");
    await expect(log).toContainText("GitHub:");

    await run(page, "vim about.txt");
    await expect(page.locator(".vim-status")).toBeVisible();
    // 真终端切到备用屏幕缓冲区：滚动历史整个看不见，页面也滚不动
    await expect(log, "vim 开着时不该看得到之前的输出").toBeHidden();
    expect(
      await page.evaluate(() => document.body.scrollHeight <= window.innerHeight),
      "整屏程序开着时不该有可滚动的区域"
    ).toBe(true);

    await page.keyboard.type(":q");
    await page.keyboard.press("Enter");
    await expect(page.locator(".vim-status")).toBeHidden();

    // 退出后历史原样回来，而且 vim 那一屏什么都没留下
    await expect(log).toBeVisible();
    await expect(log).toContainText("GitHub:");
    await expect(log, "备用屏幕退出后不该留下编辑器的内容").not.toContainText("~\n~");
    expect((await log.innerText()).trim().split("\n").pop()).toContain("vim about.txt");
  });

  test("vim 真能编辑，但保存不了 —— 文件系统是只读的", async ({ page }) => {
    const { log, input } = await boot(page);
    const status = page.locator(".vim-status");

    await run(page, "vim skills.txt");
    await expect(status).toBeVisible();
    await expect(status, "打开时报文件名和大小").toContainText("skills.txt");
    await expect(status).toBeInViewport();

    // 光标是真画出来的，j 走一行它跟着走
    const cursorLine = () => page.locator(".vim pre > div").filter({ has: page.locator(".vim-cursor") });
    await expect(cursorLine()).toHaveCount(1);
    const before = await cursorLine().innerText();
    await page.keyboard.press("j");
    expect(await cursorLine().innerText()).not.toBe(before);

    // 编辑是真的
    await page.keyboard.press("i");
    await expect(status).toContainText("-- INSERT --");
    await page.keyboard.type("XY");
    await expect(page.locator(".vim pre")).toContainText("XY");
    await page.keyboard.press("Escape");

    // 但存不下去：真 vim 打开只读文件也是这句
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
    await expect(status).toContainText("E45: 'readonly' option is set");

    // 改过之后 :q 会拦，:q! 才走
    await page.keyboard.type(":q");
    await page.keyboard.press("Enter");
    await expect(status).toContainText("E37: No write since last change");

    // 这些按键一个都没漏进提示符
    await expect(input).toHaveValue("");

    await page.keyboard.type(":q!");
    await page.keyboard.press("Enter");
    await expect(status).toBeHidden();
    await run(page, "whoami");
    await expect(log).toContainText("heimnad");
  });

  test("插入模式能打中文 —— 输入法合成完整串进缓冲区", async ({ page }) => {
    await boot(page);
    await run(page, "vim skills.txt");
    await expect(page.locator(".vim-status")).toBeVisible();

    await page.keyboard.press("i");
    await page.keyboard.type("你好");
    await expect(page.locator(".vim pre")).toContainText("你好");

    // 内容不能落到文件里：退出后 cat 还是原样
    await page.keyboard.press("Escape");
    await page.keyboard.type(":q!");
    await page.keyboard.press("Enter");
    await run(page, "cat skills.txt");
    await expect(term(page).log.locator(".line").last()).not.toContainText("你好");
  });
});

// less 是这台机器上第一个接管键盘的程序。状态机在单测里全覆盖了，
// 这里只验那件单测验不了的事：开着的时候提示符一个键都收不到
test.describe("less", () => {
  // 视口写死：行数按窗口高度算，不固定的话"翻得动"就取决于跑在多大的屏上。
  // 内容也得确定够长 —— 第一版用 /proc/cpuinfo，结果 CI 的 runner 核少、
  // 输出装得下一屏，空格无事可做，本地绿 CI 红
  test.use({ viewport: { width: 900, height: 400 } });

  test("less 开着时键盘归它，q 才还回来", async ({ page }) => {
    const { log, input } = await boot(page);
    const status = page.locator(".pager-status");

    await run(page, "man less");
    await run(page, "cat posts/why-a-terminal.md | less");
    await expect(status).toBeVisible();
    await expect(status).toContainText("(stdin)");
    // 打开时必须自己滚过去。滚动原来只在 lines 变化时触发，而 less 不产生行 ——
    // 分页器渲染在屏幕外，敲完命令看上去什么都没发生
    await expect(status, "分页器要滚进视口，不能留在屏幕外").toBeInViewport();
    await expect(page.locator(".pager pre")).toBeInViewport();

    const firstScreen = await page.locator(".pager pre").innerText();
    await page.keyboard.press("g"); // 先回顶，位置确定
    await page.keyboard.press(" ");
    expect(await page.locator(".pager pre").innerText()).not.toBe(firstScreen);

    // 关键：这些键没有一个跑到提示符里去
    await expect(input).toHaveValue("");

    await page.keyboard.press("q");
    await expect(status).toBeHidden();

    // 还回来之后照常敲命令
    await run(page, "whoami");
    await expect(log).toContainText("heimnad");
  });

  test("less 里能搜中文，搜完输入框不留残渣", async ({ page }) => {
    const { log, input } = await boot(page);
    await run(page, "cat posts/why-a-terminal.md | less");
    const status = page.locator(".pager-status");
    await expect(status).toBeVisible(); // 命令是异步的，别在分页器出现前就按键

    await page.keyboard.press("/");
    // 中文得走输入框才合成得出来 —— 搜索时全都 preventDefault 的话这里会是空的
    await page.keyboard.type("终端");
    await expect(status, "状态行就是搜索框").toHaveText("/终端");

    await page.keyboard.press("Enter");
    await expect(status).toContainText("(stdin)");
    await expect(input, "回车后搜索词要清掉，不能留成下一条命令").toHaveValue("");

    await page.keyboard.press("q");
    await expect(status).toBeHidden();
    // 搜索词绝不能被当成命令执行
    await expect(log).not.toContainText("终端: 未找到命令");
  });

}); // less

// 这两条要真的联网，验的是别人家接口的行为 —— 桩测不了"wttr.in 到底
// 给不给浏览器读"，而那正是这条命令能不能存在的前提。
//
// CI 里跳过：wttr.in 是免费社区服务，每次 push 都打它会被限流；而且别人
// 宕机让 CI 变红，只会教人忽略红灯。解析和排版有 tests/weather.test.mts 覆盖，
// 那份夹具就是从真实响应删减来的
test.describe("联网（本地跑，CI 跳过）", () => {
  test.skip(!!process.env.CI, "依赖外部服务，不该让别人的宕机决定这次提交能不能过");

  test("wttr 真的从 wttr.in 取到天气", async ({ page }) => {
    const { log } = await boot(page);
    const lastLine = log.locator(".line").last();

    await run(page, "wttr Beijing");
    // 出现温度和出处才算成功；网络抖动会让它变红，那也是真实信息
    await expect(lastLine).toContainText(/-?\d+ °C/, { timeout: 20_000 });
    await expect(lastLine).toContainText("wttr.in");
    await expect(lastLine).toContainText("Beijing");
    // 给了城市就不能说是按 IP 定位的 —— wttr 的 request.type 永远是 LatLon，
    // 拿它判断会把"查北京"说成"定位到了你"
    await expect(lastLine).not.toContainText("按你的 IP 定位");
  });

  test("curl 对站外说真话：能读的读得到，读不到的不假装是 DNS", async ({ page }) => {
    const { log } = await boot(page);
    const lastLine = log.locator(".line").last();

    // wttr.in 发了 Access-Control-Allow-Origin，所以真的读得到
    await run(page, "curl https://wttr.in/tokyo?format=j1");
    await expect(lastLine).toContainText("current_condition", { timeout: 20_000 });

    // 没发 CORS 头的站点读不到 —— 但报的是"没能连上"，不是编的 DNS 失败
    await run(page, "curl https://example.com");
    await expect(lastLine).toContainText("Failed to connect to example.com", { timeout: 20_000 });
    await expect(lastLine).not.toContainText("Could not resolve host");
  });

}); // 联网用例到此为止

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
