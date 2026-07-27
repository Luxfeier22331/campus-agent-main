# ingestion-control

基于 Temporal 的离线任务控制面和内部门户文件发布 workflow 入口。

## 所有权

本应用处理两类互相独立的执行：

- 注册任务：校验 `ingestion_task_envelope.v3` 与 registry snapshot，启动 Rust kernel workflow，
  并在 PostgreSQL 保存有界任务投影；
- 文件发布：按获准内部调用提交的精确 ID 启动独立 workflow，调用 source-collector Activity，
  并从 Temporal 查询这些 workflow 的状态；当前 Ops Web 不提供该入口。

文件发布 workflow 不是 ingestion task，不进入任务注册表或 PostgreSQL 任务投影，不生成父子
pipeline、物化阶段、离线发布流或 derived 产物。通知采集和定期认证检查均不属于本应用。

## 运行角色

| 角色 | 命令 | 职责 |
| --- | --- | --- |
| HTTP API | `pnpm --filter ingestion-control start:api` | 准入注册任务、提交文件发布、查询任务与 workflow 状态。 |
| Temporal worker | `pnpm --filter ingestion-control start:temporal-worker` | 运行 workflow、任务投影 Activity 和 Rust kernel bridge。 |
| Schema bootstrap | `pnpm --filter ingestion-control schema:bootstrap` | 创建固定 schema 和 runtime role 权限。 |
| Schema migration | `pnpm --filter ingestion-control migrate` | 按顺序执行 SQL migration 并校验 journal。 |

生产 worker 通过 Temporal Worker Controller 部署。当前队列为：

- `campus-agent.ingestion.workflow`
- `campus-agent.ingestion.activity.control`
- `campus-agent.ingestion.activity.rust-kernel`
- `campus-agent.ingestion.activity.source-collector`

最后一条队列由 source-collector worker 轮询，只承载文件发布采集 Activity。

## HTTP 接口

- `POST /internal/ingestion/tasks`：准入一个注册任务；
- `GET /internal/ingestion/tasks/:taskId`：读取完整任务记录；
- `GET /internal/ingestion/operations/tasks`：分页查询任务投影；
- `GET /internal/ingestion/operations/tasks/:taskId`：查询任务详情；
- `POST /internal/ingestion/operations/tasks/:taskId/retry`：用新 task ID 重试失败或取消的任务；
- `POST /internal/ingestion/operations/internal-portal/file-releases`：一次提交最多 50 个精确 ID；
- `POST /internal/ingestion/operations/internal-portal/file-releases/status`：按提交返回的 workflow ID
  查询 Temporal 状态；
- `GET /healthz` 与 `GET /readyz`：进程和依赖状态。

完整字段与响应以 `openapi.yaml` 为准。

## 存储

PostgreSQL 只保存注册任务投影和 migration journal。Temporal 保存 workflow 状态；source bucket
保存文件发布的原文件与 `source.json`；注册 Rust kernel 的输入输出仍按各自对象引用合同使用
source 或 derived bucket。

`0005_remove_internal_portal_pipeline.sql` 删除旧 source-collector/TypeScript 任务、父 pipeline
字段、离线发布表和旧通知边界表。已发布的早期 migration 保持不变。

## 本地运行

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

数据库 TLS、对象存储和 Temporal 环境变量见
`env/commands/ingestion-control-runtime.env.example`。本地 worker 可以不设置 Temporal deployment
版本变量。

## 验证

```bash
pnpm ci:ingest
pnpm ci:ingestion-control-postgres
```
