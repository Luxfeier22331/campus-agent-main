# source-collector

内部门户 HTTP 适配器、文件发布 Temporal Activity 和本地通知采集命令。

## 所有权

source-collector 使用直接传入的 TGC 建立当前执行所需的门户会话，只写 source bucket。进程不保存或
定期检查凭据，不启动 workflow，不维护 ingestion task 或 PostgreSQL 投影，不写 derived bucket，也
不发布在线查询目标。TGC 的持久化、验证和定时检查由 Ops Web 负责。

## 文件发布

ingestion-control 为每个精确文件发布 ID 启动 workflow，source-collector worker 只执行采集 Activity。
对象合同、幂等写入和结果引用见 `docs/contracts/internal-portal-file-release.md`，提交与排查步骤见
`docs/runbooks/ingestion.md`。

```bash
pnpm --filter source-collector start:temporal-worker
```

worker 只轮询 `campus-agent.ingestion.activity.source-collector`。Kubernetes base 不注入开发者 TGC，
源码清单存在不表示环境已经开放已认证采集。

## 通知

通知入口是本地命令，不进入 Temporal、任务注册表或 Ops API：

```bash
pnpm dev:init
pnpm --filter source-collector notice:sync
pnpm --filter source-collector notice:backfill --start-date 2026-08-01
pnpm --filter source-collector notice:status
pnpm --filter source-collector notice:resources --dry-run --notice-id 123456
```

来源对象、同步边界和资源语义由 `docs/data/notices.md` 维护；从小范围采集到显式发布的完整步骤见
`docs/runbooks/ingestion.md`。通知命令不写分类、消费、发布或用户状态，也不抓取外部正文。

## 认证

开发者从 Ops Web 取得目标凭据后，通过未跟踪的 `INTERNAL_PORTAL_SSO_TGC` 传入原始 TGC。
source-collector 不读取 Ops Web 数据库或 Kubernetes Secret，派生 Cookie 和 Service Ticket 不跨执行
保存。

```bash
pnpm --filter source-collector auth:check
```

凭据录入、轮换和本地配置步骤见 `docs/runbooks/portal-auth.md`。

## 验证

```bash
pnpm --filter source-collector typecheck
pnpm --filter source-collector test
```
