# eval-langfuse

TypeScript Agent 用例、产品路径评测和 Langfuse trace/score 适配 package。

## 职责

- 读取调用方显式提供的 Agent 用例；
- 手动通过真实 App API 执行 Agent case，读取完成 run 的评测投影；
- 构造不含平台字段的 `ragas_sample_batch.v2`，调用 `packages/ragas-runner`，并把允许的 score
  适配到真实 trace；
- 校验在线 trace 的 release、session、用户和产品关联信息；
- 维护代码级 Langfuse score allowlist，不同步第二份 score registry。

本 package 不实现自研 RAG 指标，不参与在线 Agent 执行，不从普通 trace 或 Langfuse 反查 RAG 正文，
也不同步 Langfuse dataset。离线 Ragas 的 native 输入由调用方或产品路径适配器显式生成。

本 package 只提供 CLI，不维护无消费者的 package 根导出。内部和测试按 Agent 用例、产品执行、score
发布、Ragas 适配、trace 身份和在线证据等行为域直接导入所属模块。

```bash
pnpm --dir packages/eval-langfuse typecheck
pnpm --dir packages/eval-langfuse test
pnpm --dir packages/eval-langfuse exec tsx src/cli.ts <command> --json
```

命令和环境输入见 `docs/runbooks/ragas.md`，用例与 score 约定见 `docs/reference/eval.md`。
