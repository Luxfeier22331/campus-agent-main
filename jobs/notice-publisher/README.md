# 通知发布器

`notice-publisher` 是来源通知进入 `notices.*` 规范化投影的唯一显式写入入口。它读取 source bucket、
模型生成并完成完整性校验的 `notice_id/category` JSONL 和来源资源，写入内容寻址的 derived 对象，再用一个
PostgreSQL 事务写入通知、映射和资源 metadata。分类必须使用共享通知合同中的值，且同一通知只能
出现一次。

发布器不抓取外部网页、不自动调度、不保存分类模型 metadata，也不创建批次状态。相同输入可以
幂等重跑；来源、schema 或已有投影冲突时整批失败。

单分类 migration 5 只接受空的 `notices.notices` 投影。它不会把旧分类值映射到新 taxonomy，也不会
保留兼容列；已有本地旧投影应先按 runbook 清空，再运行 migration 和重新发布。该约束描述当前本地
实现，不表示集群已经创建 publisher workload 或完成数据发布。

## 运行

先按 `docs/runbooks/ingestion.md` 完成来源采集、资源 dry-run 和分类完整性校验，再运行：

```bash
set -a
. apps/app-api/.env.local
set +a
NOTICES_DATABASE_URL="$APP_API_SCHEMA_DATABASE_URL" pnpm --filter notice-publisher migrate

INTERNAL_PORTAL_BASE_URL=https://portal.example.edu \
  pnpm --filter notice-publisher run publish \
  --classifications /absolute/path/to/classifications.jsonl \
  --notice-id 123456
```

运行时显式提供 `NOTICES_DATABASE_URL`、`INTERNAL_PORTAL_BASE_URL`、
`OBJECT_STORE_ENDPOINT`、`OBJECT_STORE_BUCKET_SOURCE`、`OBJECT_STORE_BUCKET_DERIVED`，以及
`OBJECT_STORE_SOURCE_ACCESS_KEY` / `OBJECT_STORE_SOURCE_SECRET_KEY` 和
`OBJECT_STORE_DERIVED_ACCESS_KEY` / `OBJECT_STORE_DERIVED_SECRET_KEY` 两套身份。发布器通过 source
身份只读取来源，通过 derived 身份读写内容寻址资源，不使用跨 bucket 的管理身份。历史附件链接回填、
批量发布、产品验收和仅限本地的投影重建均由 runbook 统一维护。数据字段、正文清洗和资源所有权见
`docs/data/notices.md`。

## 验证

```bash
pnpm --filter notice-publisher typecheck
pnpm --filter notice-publisher test
pnpm --filter notice-publisher test:migration-integration
```
