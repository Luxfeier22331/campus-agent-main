# 通知发布器

`notice-publisher` 清洗已经登记且已有分类的通知，校验 source 资源，并逐条在数据库事务中写入正文、
资源 metadata 和发布状态。图片写入 derived bucket，附件字节保留在 source bucket；该包不负责采集
或分类。

自动发布排除 `notices.processing_failures` 中的 publication 问题；明确的单条来源校验错误记录后继续，
数据库与对象存储故障停止本轮。指定 notice ID 的人工重试成功提交后清除当前问题。CLI 使用会话级
数据库锁，定时与人工入口互斥；锁忙返回 skipped，不执行发布。

## 入口

- `src/cli.ts`：通知发布和附件链接回填入口；
- `src/publisher.ts`：来源校验、清洗与发布流程；

```bash
pnpm dev:init -- --target notice-publisher
pnpm --filter notice-publisher publish
pnpm --filter notice-publisher publish -- --notice-id 123456
pnpm --filter notice-publisher run republish
pnpm --filter notice-publisher run republish --notice-id 123456
```

通知 schema 与授权由 `campus-agent-schema` 安装。`pnpm dev:init -- --target notice-publisher` 准备托管环境，
分类目录属于环境 bootstrap，已有目录通过 readiness 复用；它不导入通知业务数据。

普通 `publish` 批量选择已有分类且未发布、或 `source_ref` 与 `published_source_ref` 不同的通知；
`republish` 批量选择已发布通知，显式 `--notice-id` 限定指定通知。两者都从当前来源物化 metadata、
正文和资源，在同一事务中切换公开投影并记录 `published_source_ref`，保持已有分类；重新发布保持已发布状态。
外链通知只物化 metadata 和 URL，不生成站内正文或资源。图片写入 derived bucket，附件字节留在 source bucket。
相同来源重复执行保持幂等，发布期间来源变化时拒绝提交。CLI 本身不触发 Chunk、Embedding 或 RAG；
集群流水线负责后续制品刷新，见[采集运行](../../docs/runbooks/ingestion/ingestion.md)。

## 相关文档

- 操作步骤与故障排查：`docs/runbooks/ingestion/ingestion.md`
- 通知数据布局：`docs/data/notices.md`
- 通知领域边界：`docs/architecture/domains/notices.md`
