# 食堂同步任务

`jobs/dining-sync` 是 Feishu/Lark 食堂来源同步、评价审核和 Dining schema migration 的可部署
Job runtime，不是长驻 app，也不处理在线 `/api/dining/*`。

## 责任

- 增量同步 catalog records 到 `dining.source_observations`；
- 增量同步 review records，执行文本/图片审核并把公开附件物化到 S3-compatible object storage；
- 将 review observations upsert 到 `dining.reviews`；
- 处理 Ops 请求的评价复检；
- 为本地开发导入唯一 deterministic dev seed，其中地图只保存稳定 floorplan 引用和 anchor 绑定；
- 用专用 migration credential 重建 Dining schema。

Catalog observations 不在 job 中自动发布。`apps/ops-web` 执行 rebase、validate、publish 和
rollback。`apps/app-api` 只读取 publication、release 和公开评价。

## 命令

```bash
pnpm --dir jobs/dining-sync typecheck
pnpm --dir jobs/dining-sync test
pnpm --dir jobs/dining-sync exec tsx src/cli.ts sync-all
pnpm --dir jobs/dining-sync exec tsx src/cli.ts catalog-observations
pnpm --dir jobs/dining-sync exec tsx src/cli.ts run
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
pnpm --dir jobs/dining-sync exec tsx src/cli.ts migrate
pnpm --dir jobs/dining-sync exec tsx src/cli.ts migrate-local
pnpm --dir jobs/dining-sync exec tsx src/cli.ts import-dev-seed
```

- `sync-all`：先 catalog observations，再 review sync/rechecks；Kubernetes CronJob 每小时运行。
- `catalog-observations`：只同步 catalog source observations。
- `run`：只同步评价和处理复检。
- `verify-published`：只读当前 publication/release/reviews，输出 closeout summary。
- `migrate`：只接受 `DINING_MIGRATION_DATABASE_URL`，供 K8s PreSync Job 使用。
- `migrate-local`：只接受本地 `DATABASE_URL`，由根目录 `pnpm dev:prepare` 调用。
- `import-dev-seed`：只允许非 production，导入已提交地图引用、档口、菜品和合成评价。

## 配置

### Runtime sync

- `DATABASE_URL`
- `DINING_LARK_APP_ID`、`DINING_LARK_APP_SECRET`、`DINING_LARK_BASE_TOKEN`
- `DINING_LARK_CAMPUS_TABLE_ID`、`DINING_LARK_HALL_TABLE_ID`
- `DINING_LARK_STALL_TABLE_ID`、`DINING_LARK_DISH_TABLE_ID`
- `DINING_LARK_REVIEW_TABLE_ID`、`DINING_LARK_REVIEW_VIEW_ID`
- `DINING_MODERATION_*`
- `OBJECT_STORE_ENDPOINT`、`OBJECT_STORE_REGION`
- `OBJECT_STORE_ACCESS_KEY`、`OBJECT_STORE_SECRET_KEY`
- `DINING_OBJECT_STORE_BUCKET`、`DINING_OBJECT_STORE_PUBLIC_BASE_URL`
- `DINING_OBJECT_STORE_REVIEW_PREFIX`

### Migration

`DINING_MIGRATION_DATABASE_URL` 只通过 `dining-migration-secrets` 注入 PreSync migration Job。
CronJob 的 `dining-sync-secrets` 不包含该 key，`dining_sync` 角色不得
重建 schema。Kubernetes Secret key 名和数据库 role grant 见
`infra/k8s/dining-sync/base/migration-job.yaml` 与 `migrations/0001_dining.sql`。

## 同步语义

Source observation 使用稳定 id upsert、content hash 和 last-seen run；本轮未出现的记录标记
`stale_at`。单条非法记录写 blocked observation，不阻塞其他记录。

评价首次落库后不更新提交正文、姓名、评分、价格、图片或提交时间。后续只更新审核、可见性和当前
offering binding。blocked 内容始终 hidden，即使存在旧 restore override。只有公开投影摘要变化时
才递增 `publication.review_revision`。

## 附件

图片先写入 moderation prefix，审核通过后复制到 public review prefix。公开记录不保存 Feishu
file token 或临时 URL。同步结束后清理不再被 active accepted review observations 引用的公开图片。

## 部署

`Dockerfile` 是 Job/CronJob 共用镜像。Kustomize base 包含：

- hourly `CronJob/dining-sync`，命令 `sync-all`；
- Argo CD PreSync `Job/dining-migrate`，命令 `migrate`；
- namespace-neutral ConfigMap 和 ServiceAccount。

环境仓拥有 Secret、namespace、NetworkPolicy、不可变镜像 tag 和实际部署。
