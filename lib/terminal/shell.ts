// 管道执行器：把 "a | b | c" 串起来跑。纯逻辑，见 shell.test.mts
import { ALIASES, available, COMMANDS, type Ctx, type Visual } from "./commands.ts";

export type ExecResult = {
  /** string 可进管道；Visual 只能是最后一环；undefined 表示无输出 */
  output?: string | Visual;
  error?: string;
};

/**
 * 把整行切成若干阶段，每阶段一组 token。引号里的空格和 | 都不算分隔符。
 *
 * 以前是 split("|") 再 split(/\s+/)，于是 cut -d\' \' 和 tr \' \' \'\\n\' 这类
 * 最常见的用法根本表达不了 —— 空格分隔符写不出来。加了 cut/tr 之后
 * 引号从"可以不做"变成了必须做
 */
export function tokenize(input: string): string[][] {
  const stages: string[][] = [];
  let tokens: string[] = [];
  let cur = "";
  let started = false; // 认得出 \'\' 这种空参数
  let quote: '"' | "'" | null = null;

  const endToken = () => {
    if (started) tokens.push(cur);
    cur = "";
    started = false;
  };

  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "|") {
      endToken();
      stages.push(tokens);
      tokens = [];
      continue;
    }
    if (/\s/.test(ch)) {
      endToken();
      continue;
    }
    cur += ch;
    started = true;
  }
  endToken();
  stages.push(tokens);
  return stages;
}

export async function execute(input: string, ctx: Omit<Ctx, "piped">): Promise<ExecResult> {
  const stages = tokenize(input);
  let stdin: string | null = null;
  let output: string | Visual | undefined;

  try {
    for (let i = 0; i < stages.length; i++) {
      // 别名在查命令之前展开，只认第一个词 —— 和真 shell 一样。
      // 所以 ll 会变成 ls -l，再和用户自己给的参数拼起来
      // 查表一律用 hasOwn：`ALIASES["__proto__"]` 走原型链会取到 Object.prototype，
      // 再 .split 就抛一个泄漏内部实现的 TypeError，而不是"未找到命令"
      const tokens = [...stages[i]];
      if (tokens[0] && Object.hasOwn(ALIASES, tokens[0]))
        tokens.splice(0, 1, ...ALIASES[tokens[0]].split(/\s+/));

      const [name, ...args] = tokens;
      if (!name)
        throw new Error(ctx.t("语法错误：管道旁边缺少命令", "syntax error: missing command near |"));
      const found = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
      const cmd = found && available(found, ctx.pkgs) ? found : undefined;
      if (!cmd) {
        // 命令存在但包没装 —— 照抄 Ubuntu 的 command-not-found，
        // 它顺带就是这套包管理的发现机制，不需要在 help 里另外打广告
        if (found?.pkg)
          throw new Error(
            `Command '${name}' not found, but can be installed with:\n` +
              `sudo apt install ${found.pkg}`
          );
        throw new Error(
          ctx.t(
            `${name}: 未找到命令。输入 help 查看可用命令。`,
            `${name}: command not found. Type help to see what works.`
          )
        );
      }

      const isLast = i === stages.length - 1;
      // 读文件的命令是 async，只看结构的是同步 —— await 对两者都成立
      output = (await cmd.run(args, stdin, { ...ctx, piped: !isLast })) ?? undefined;

      if (!isLast) {
        if (typeof output !== "string")
          throw new Error(
            ctx.t(`${name}: 输出不是文本，不能接管道`, `${name}: output is not text, cannot pipe it`)
          );
        stdin = output;
      }
    }
    return { output };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
