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

通知 schema 与授权由 `campus-agent-schema` 安装。`pnpm dev:init -- --target notice-publisher` 在生成托管 `.env.local` 后调用
`seed-local`，后者只向隔离的本地数据库写入通知分类，不创建表，也不维护 migration ledger。

`republish` 读取已发布、站内通知的 source bucket 原始正文，重新生成 `content_html` 和 `content_text`，
保持 `is_published`、分类和来源 metadata 不变。无 `--notice-id` 时处理全部已发布站内通知，有
`--notice-id` 时只处理指定通知；没有正文的通知跳过批量处理，单条处理失败。正文没有变化时成功并
保持幂等。它只更新正文投影，不触发 Chunk、Embedding、Collection 或 RAG。显式指定已发布通知时，
普通 `publish` 仍只做来源、正文和资源一致性校验，不会覆盖正文。外链通知只发布来源 metadata 和
URL。图片写入 derived bucket，附件字节继续保留在 source bucket。

## 相关文档

- 操作步骤与故障排查：`docs/runbooks/ingestion.md`
- 通知数据布局：`docs/data/notices.md`
- 通知领域边界：`docs/architecture/domains/notices.md`
