# Langfuse Trace 校验

本包保留在线 trace metadata 的独立校验。Agent 用例执行与评分由
[Inspect 评测](../inspect-eval/README.md)拥有；Ragas 和 Langfuse score 发布已退役。

```bash
pnpm --dir packages/eval-langfuse typecheck
pnpm --dir packages/eval-langfuse test:unit
pnpm --dir packages/eval-langfuse exec tsx src/cli.ts verify-trace --request-id <id> --trace-id <id> --json
```

配置沿用 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY` 和 `LANGFUSE_BASE_URL`。
本包不读取或导出 prompt、答案及工具正文，不从 trace 生成 eval 输入。
