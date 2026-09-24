# notice-classifier-core

`packages/notice-classifier-core` 拥有仅基于通知标题的模型分类核心：提示词、输出 schema、
提供方客户端、重试与并发。

负责：

- `NOTICE_CLASSIFIER_SYSTEM_PROMPT` 与 zod 输出 schema：分类集合与裁决规则来自
  `campus-contracts/notices` 和 `packages/domains/notices` 的 taxonomy，模型只输出
  `{ "category": ... }`，temperature 0；
- `classifyNotice` 重试：最多 3 次（间隔 15s/30s），无效输出与可重试提供方错误触发重试，
  `NoticeClassificationProviderError`（不可重试）直接抛出；
- `classifyNoticeBatch` 并发批处理：默认并发 2，首个失败即短路（fail-fast）；
- `createNoticeModelFetch` 构造 OpenAI 兼容网关客户端（剥离 `user-agent`，保留原始响应用于
  评测），`source.ts` 定义 source 对象键（`internal_portal/notices/<id>.json`，schema v2）。

本包不读写数据库、不拥有 Job 编排和环境变量解析。消费者为 `jobs/notice-classifier` 和
`scripts/notices/` 评测工具链。领域语义（单一用户分类、离线过程边界）见
`docs/architecture/domains/notices.md`，评测边界见
`.agents/notes/implemented/testing/2026-08-21-eval-boundaries.md`。

```bash
pnpm --dir packages/notice-classifier-core typecheck
pnpm test --filter=notice-classifier-core
```
