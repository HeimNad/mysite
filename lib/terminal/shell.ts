// 管道执行器：把 "a | b | c" 串起来跑。纯逻辑，见 shell.test.mts
import { ALIASES, COMMANDS, type Ctx, type Visual } from "./commands.ts";

export type ExecResult = {
  /** string 可进管道；Visual 只能是最后一环；undefined 表示无输出 */
  output?: string | Visual;
  error?: string;
};

export async function execute(input: string, ctx: Omit<Ctx, "piped">): Promise<ExecResult> {
  const stages = input.split("|").map((s) => s.trim());
  let stdin: string | null = null;
  let output: string | Visual | undefined;

  try {
    for (let i = 0; i < stages.length; i++) {
      // 别名在查命令之前展开，只认第一个词 —— 和真 shell 一样。
      // 所以 ll 会变成 ls -l，再和用户自己给的参数拼起来
      const tokens = stages[i].split(/\s+/).filter(Boolean);
      if (tokens[0] && ALIASES[tokens[0]])
        tokens.splice(0, 1, ...ALIASES[tokens[0]].split(/\s+/));

      const [name, ...args] = tokens;
      if (!name)
        throw new Error(ctx.t("语法错误：管道旁边缺少命令", "syntax error: missing command near |"));
      const cmd = COMMANDS[name];
      if (!cmd)
        throw new Error(
          ctx.t(
            `${name}: 未找到命令。输入 help 查看可用命令。`,
            `${name}: command not found. Type help to see what works.`
          )
        );

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
