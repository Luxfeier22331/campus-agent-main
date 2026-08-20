# ingestion-control

内部门户凭据池的运行所有者和内部 HTTP API。

## 所有权

- 在 `ingestion_control.internal_portal_credentials` 保存具名 TGC、版本和最近检查结果；
- 录入、轮换、人工检查和消费解析前都通过共享门户客户端做真实认证；
- 为 Ops Web 和 internal-portal-collection 提供使用 `OPS_WEB_INTERNAL_TOKEN` 鉴权的内部接口；
- 由同镜像 CronJob 每 30 分钟检查未暂停凭据；
- 安装自身 schema migration，并在升级时删除已退役的 ingestion Temporal 任务表。

本应用不编排采集步骤，不运行 Temporal worker，不读写对象存储，也不执行通知或文件采集。Rust
kernel 仍是独立命令和库，不通过本应用注册或调度。

## 运行入口

| 入口 | 命令 | 职责 |
| --- | --- | --- |
| HTTP API | `pnpm --filter ingestion-control start:api` | 凭据管理、验证、明文读取和采集解析。 |
| 定时检查 | `pnpm --filter ingestion-control credentials:check` | 顺序检查当前凭据池并写回有界结果。 |
| Schema bootstrap | `pnpm --filter ingestion-control schema:bootstrap` | 创建固定 schema 并收回 runtime DDL 权限。 |
| Schema migration | `pnpm --filter ingestion-control migrate` | 使用 schema owner 按顺序执行 SQL migration。 |

本地命令直接运行 TypeScript；镜像构建使用 `pnpm --filter ingestion-control build` 生成四个 ESM
入口，Deployment、CronJob 和 migration Job 只执行 `node dist/*.js`，不在环境中转译源码。

HTTP 字段与错误响应以 `openapi.yaml` 为准。健康检查为 `GET /healthz` 和 `GET /readyz`；凭据接口前缀为
`/internal/ingestion/internal-portal/credentials`。

## 数据库升级

Ops Web migration `0004_loud_loa.sql` 先把旧 `internal_portal.credentials` 全量复制到
`ingestion_control.internal_portal_credentials`，双向比较字段后删除旧表。随后本应用 migration
`0007_retire_temporal_tasks.sql` 接管 migration journal 和凭据表所有权，并删除已退役的
`ingestion_control.tasks`。旧 staging 曾由 `ingestion_control` 创建并拥有 schema；历史环境按迁移步骤
完成一次性对象接管。新环境不要求数据库 owner `campus_agent` 成为 runtime role 的成员。bootstrap 会把
schema owner 改为当前数据库 owner，再收回 runtime DDL 权限。

首次交接时，环境仓必须把 Ops Web 与 ingestion runtime 的 base 组合到同一个 Application，并按现有
sync wave 先运行 Ops Web migration，再运行 ingestion migration 和两个 workload；不同 Application 的
wave 不能作为该顺序的证据。

常驻进程只使用 `INGESTION_CONTROL_DATABASE_URL`。bootstrap 和 migration 必须使用
`INGESTION_CONTROL_SCHEMA_DATABASE_URL`；该连接使用既有数据库 bootstrap 角色，不复用 runtime role。
最终 runtime role 只获得 schema `USAGE` 和凭据表的 `SELECT`、`INSERT`、`UPDATE`、`DELETE`。

## 验证

```bash
pnpm --filter ingestion-control build
pnpm --filter ingestion-control typecheck
pnpm --filter ingestion-control test
pnpm --dir apps/ingestion-control test:database-integration
```
