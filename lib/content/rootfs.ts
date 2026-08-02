// 根文件系统骨架。content/ 挂载到 /home/<user>，其余是给爱翻目录的人准备的
//
// 这些文件的内容中英各写一份，放在同一个文件里 —— 而不是搞 /etc/motd.en 那套。
// 理由：它们已经是按需加载的，双语不占首屏；而 /api/fs 的端点是按路径静态生成的，
// 让内容随语言变就得把语言塞进路径，为几个玩笑文件不值得
import type { FSDir } from "../terminal/fs.ts";
import { ME, OS_NAME, SHELL_PATH, VERSION } from "../site/me.ts";
import { ALIASES, COMMANDS } from "../terminal/commands.ts";

/** /bin 从命令注册表生成，这样加了新命令它自己会长出来，不会过期 */
function bin(): FSDir {
  const out: FSDir = {};
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    if (name === ":q") continue; // 不是合法文件名
    if (cmd.pkg) continue; // 还没装的包不该有可执行文件躺在 /bin 里
    out[name] = [
      `#!${SHELL_PATH}`,
      `# ${cmd.desc.zh}`,
      `# ${cmd.desc.en}`,
      "#",
      `# 真的二进制文件里没有诗，但这里可以有。用 man ${name} 看用法。`,
      `# Real binaries hold no poetry. This one can. See: man ${name}`,
    ].join("\n");
  }
  return out;
}

export function mountRootfs(home: FSDir): FSDir {
  return {
    bin: bin(),
    etc: {
      hostname: ME.host,
      motd: `欢迎来到 ${ME.host}。

这台机器由一个${ME.title.zh}维护，运行在你的浏览器里。
所有内容只读，随便翻。

help 看能做什么，posts 看我写了什么。

---

Welcome to ${ME.host}.

This machine is maintained by ${ME.title.en} and runs entirely inside
your browser. Everything is read-only, so poke around.

help lists what works. lang en switches to English.`,
      passwd: `root:x:0:0:root:/root:/bin/nologin
${ME.user}:x:1000:1000:${ME.name}:/home/${ME.user}:${SHELL_PATH}
nobody:x:65534:65534:every project has a nobody to blame / 每个项目都有个背锅的:/nonexistent:/bin/false`,
      "os-release": `NAME="${OS_NAME}"
PRETTY_NAME="${OS_NAME} ${VERSION} (浏览器里的假 Linux)"
VERSION="${VERSION}"
VERSION_ID="${VERSION}"
ID=fakeos
HOME_URL="${ME.repo}"`,
    },
    // .bashrc 从 ALIASES 生成，所以里面写的每一条都真的能用，也不会和实现脱节
    home: {
      [ME.user]: {
        ...home,
        ".bashrc": [
          "# ~/.bashrc",
          "",
          ...Object.entries(ALIASES).map(([k, v]) => `alias ${k}='${v}'`),
          "",
          "# neofetch 没放在这里，登录时不会自动跑",
          "# neofetch is deliberately not here, so logging in stays quiet.",
        ].join("\n"),
      },
    },
    root: {}, // 权限不够，进不去也没东西
    tmp: {},
    usr: {
      share: {
        doc: {
          README: `内容在 /home/${ME.user}，也就是 ~。cd ~ 回去。

管道、cd、Tab 补全、相对路径、man page 都按 POSIX 的习惯工作。

---

The content lives in /home/${ME.user}, that is, ~. Run cd ~ to get there.

Pipes, cd, Tab completion, relative paths and man pages behave the way
POSIX taught you to expect.`,
        },
      },
    },
    var: {
      log: {
        "visits.log": `[INFO ] 会话开始。有一个统计页面浏览量的脚本，不种 cookie，不跨站跟踪
[INFO ] 所以站长知道有多少人来过，但不知道你是谁
[WARN ] 检测到有人在读日志文件，好奇心水平: 偏高
[INFO ] Session started. One script counts page views. No cookies, no
[INFO ] cross-site tracking. He knows how many came, not who you are.
[WARN ] Someone is reading the log files. Curiosity level: elevated.
[INFO ] 一切正常 / all systems nominal`,
      },
    },
  };
}
