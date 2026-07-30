// 根文件系统骨架。content/ 挂载到 /home/<user>，其余是给爱翻目录的人准备的
//
// 这些文件的内容中英各写一份，放在同一个文件里 —— 而不是搞 /etc/motd.en 那套。
// 理由：它们已经是按需加载的，双语不占首屏；而 /api/fs 的端点是按路径静态生成的，
// 让内容随语言变就得把语言塞进路径，为几个玩笑文件不值得
import type { FSDir } from "./fs.ts";
import { ME } from "./me.ts";
import { COMMANDS } from "./commands.ts";

/** /bin 从命令注册表生成，这样加了新命令它自己会长出来，不会过期 */
function bin(): FSDir {
  const out: FSDir = {};
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    if (name === ":q") continue; // 不是合法文件名
    out[name] = [
      "#!/bin/mysite-sh",
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
所有内容只读 —— 你弄不坏任何东西，放心翻。

输入 help 看能做什么，输入 posts 看我写了什么。

---

Welcome to ${ME.host}.

This machine is maintained by ${ME.title.en}, and it runs entirely
inside your browser. Everything is read-only — you cannot break
anything, so poke around.

Type help to see what works, or lang en if you prefer English.`,
      passwd: `root:x:0:0:root:/root:/bin/nologin
${ME.user}:x:1000:1000:${ME.name}:/home/${ME.user}:/bin/mysite-sh
nobody:x:65534:65534:every project has a nobody to blame / 每个项目都有个背锅的:/nonexistent:/bin/false`,
      "os-release": `NAME="浏览器里的假 Linux"
PRETTY_NAME="Fake Linux (in a browser tab)"
VERSION="0.5 (双语版)"
ID=mysite
HOME_URL="${ME.github}"`,
    },
    // .bashrc 是虚构的，但它让开场自洽：登录打印 motd，然后 shell 跑 .bashrc。
    // 好奇的人 cat 一下就知道 neofetch 为什么会自己出现
    home: {
      [ME.user]: {
        ...home,
        ".bashrc": `# ~/.bashrc —— 每次登录时执行 / runs on every login

neofetch

# 就这一行。登录时看到的头像就是它打印的。
# That single line is why the cat greets you.`,
      },
    },
    root: {}, // 权限不够，进不去也没东西
    tmp: {},
    usr: {
      share: {
        doc: {
          README: `这个文件系统是假的，但它的行为是真的：
管道、cd、Tab 补全、相对路径、man page 都按 POSIX 的直觉工作。

真正的内容在 /home/${ME.user}（也就是 ~）。cd ~ 回去。

---

This filesystem is fake, but its behaviour is not: pipes, cd, Tab
completion, relative paths and man pages all work the way POSIX
taught you to expect.

The actual content lives in /home/${ME.user} (that is, ~). Run cd ~ to get there.`,
        },
      },
    },
    var: {
      log: {
        "visits.log": `[INFO ] 你是第 N 位访客，N 的具体值需要一个后端，而这个站没有
[INFO ] 会话开始，没有 cookie，没有埋点，没有分析脚本
[WARN ] 检测到有人在读日志文件，好奇心水平: 偏高
[INFO ] You are visitor number N. Computing N would require a backend.
[INFO ] Session started. No cookies, no tracking, no analytics.
[WARN ] Someone is reading the log files. Curiosity level: elevated.
[INFO ] 一切正常 / all systems nominal`,
      },
    },
  };
}
