# eval-langfuse

TypeScript 评测编排、数据集和 Langfuse 平台适配 package。

## 职责

- 维护仓库评测数据集与 score 注册表；
- 同步 Langfuse datasets 和 score configs；
- 执行 Agent 工具选择评测与 RAG 数据集评测；
- 从 Langfuse trace 选择样本并发布 Ragas score；
- 核对在线 trace 的 release、session、用户和产品关联信息；
- 调用 `packages/ragas-runner` 执行 Ragas 官方指标。

本 package 不实现自研 RAG 指标，不参与在线 Agent 执行，也不从 execution-control 的在线 Provider
Config 推导评测配置。

```bash
pnpm --dir packages/eval-langfuse typecheck
pnpm --dir packages/eval-langfuse test:eval
pnpm --dir packages/eval-langfuse exec tsx src/cli.ts <command> --json
```

命令和环境输入见 `docs/runbooks/ragas.md`，数据集与 score 约定见 `docs/reference/eval.md`。
