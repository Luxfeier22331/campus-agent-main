# 通知制品 Worker

`notice-artifacts-worker` 是承载通知制品阶段的 Temporal Worker，任务队列为 `notice-artifacts`。
它由 `notice-pipeline` 主工作流编排，负责通知 Chunk/Embedding 制品的构建、统一 RAG 发布、版本清理和回滚：
`prepareRefresh` 重建 Chunk Run 并与当前激活的 Embedding Set 比对，`embedNotices` 生成缺失向量，
`publishRefresh` 登记并激活索引版本，`cleanupVersions` 清理退休版本，`rollbackIndex` 回滚到上一版本。

它直接调用外部模型 provider 生成 Embedding，其 Egress NetworkPolicy 必须保留集群外 443 出口。
与 `notice-pipeline-worker` 一起发布；调度与运行查询入口统一为 Ops `/tasks` 的 `notice-pipeline`。

## 本地运行

```bash
pnpm dev:init -- --target ops-web
pnpm --filter notice-artifacts-worker typecheck
pnpm --filter notice-artifacts-worker test:unit
```

本地初始化不调用外部模型 provider；完整制品构建需真实 provider 与对象存储，见通知索引手册。

## 相关文档

- [通知领域（架构边界）](../../docs/architecture/domains/notices.md)
- [通知索引（Chunk 与 Embedding 制品）](../../docs/runbooks/ingestion/notice-indexing.md)
- [检索服务](../../docs/architecture/system/retrieval-serving.md)
- [通知采集到 RAG 的统一 Temporal 流水线](../../.agents/notes/implemented/architecture/2026-09-20-notice-pipeline-unification.md)
