# ingestion-control

基于 Temporal 的离线采集任务控制面。

## 所有权

本应用负责：

- 通过 `ingestion_task_envelope.v3` 认证并准入 task；
- 通过 `ingestion_task_registry.v3` 校验 registry snapshot；
- 为每个 task 启动一个 Temporal workflow；
- 维护 PostgreSQL task、Official Web URL freshness 和 configured-seed 投影；
- 执行 control activity 与 Rust kernel 进程 bridge；
- 从一个由对象存储支撑的 `ingestion_task_result.v1` 写入终态投影。

本应用不采集 provider、不运行进程内 scheduler、不维护 run ledger、不发布在线查询 target，
也不执行 Python fallback handler。source capture 位于 `apps/source-collector`；确定性文件
kernel 位于 `packages/ingestion-kernels-rs`。

Temporal 还拥有固定的 `internal-portal-auth-maintenance` Schedule。部署同步命令维护其
30 分钟周期；Schedule 首次创建时暂停，凭据确认失效时再次暂停，人员通过 Ops Web 更新
凭据后恢复。该维护流程与采集任务准入和任务投影分离。

## 运行角色

| 角色 | 命令 | 职责 |
| --- | --- | --- |
| HTTP API | `pnpm --filter ingestion-control start:api` | 校验 v3 envelope、冻结 registry task、启动 Temporal 并提供有界 task 投影。 |
| Temporal worker | `pnpm --filter ingestion-control start:temporal-worker` | 轮询 workflow、control-activity 与 Rust-kernel queue，并写入终态投影。 |
| Schema migration | `pnpm --filter ingestion-control migrate` | 在一个 advisory lock 下按顺序执行 SQL migration，并校验 migration journal。 |
| Schedule 同步 | `pnpm --filter ingestion-control schedules:sync` | 创建或更新固定认证维护 Schedule，并保留现有暂停状态。 |

生产环境仍由一个 package 提供这些角色，但构建为两个 image target：

| Image | Docker target | 用途 |
| --- | --- | --- |
| `ingestion-control` | `api` | HTTP Deployment 与 schema migration command。 |
| `ingestion-control-worker` | `worker` | 包含 Rust runner 与固定 embedding tokenizer 的 Temporal WorkerDeployment。 |

source-collector activity queue 由独立 `source-collector` image 轮询。Kubernetes 生产 worker
通过 Temporal Worker Controller 的 `WorkerDeployment` 资源管理；controller 同时注入
`TEMPORAL_DEPLOYMENT_NAME` 与 `TEMPORAL_WORKER_BUILD_ID`。本地 worker 可以不设置这两个变量，
以 unversioned 方式运行。

正式 queue：

- `campus-agent.ingestion.workflow`
- `campus-agent.ingestion.activity.control`
- `campus-agent.ingestion.activity.rust-kernel`
- `campus-agent.ingestion.activity.source-collector`

## HTTP 接口

- `POST /internal/ingestion/tasks`：使用 admin token 准入 task；
- `GET /internal/ingestion/tasks/:taskId`：使用 admin token 查询 task 详情；
- `GET /internal/ingestion/operator-projection/tasks`：使用 app-api projection token 查询；
- `GET /internal/ingestion/operations/internal-portal-auth-maintenance`：使用固定运维令牌读取认证维护状态；
- `POST /internal/ingestion/operations/internal-portal-auth-maintenance/resume`：恢复固定认证维护 Schedule；
- `GET /healthz`：进程存活状态；
- `GET /readyz`：实时检查 PostgreSQL 与 Temporal 依赖。

系统没有来源专用采集生命周期接口。collector 只能由 workflow 通过 activity task queue 调用；
认证维护接口不能选择其他 Schedule、立即触发工作流或提交采集任务。

## 存储

`migrations/0001_tasks.sql` 定义当前 schema。PostgreSQL 保存有界 task 投影、最新 Official Web
URL 状态和 configured-seed 状态。Temporal 是 workflow 事实，对象存储是 artifact 事实。
source capture 使用 source bucket；Rust kernel 使用 derived-bucket credential 读写正式输入与
确定性输出。所需 database schema 缺失或仍含已退役的 lease/task-kind column 时，进程启动失败。

对象写入采用 create-or-verify，所有跨 runtime ref 都包含 SHA-256 digest 与 byte size。
preparation、Rust-kernel 和 terminal result artifact 按 attempt 写入
`runs/<run-id>/attempts/<activity-attempt>/`；retry 不能覆盖早期 attempt 的 bytes。Official
Web freshness upsert 按 `(observed_at, last_observed_run_id)` 排序，使 timestamp 相同时也能
确定性收敛，迟到 run 不会覆盖更新状态。

## 本地运行

启动 Temporal、PostgreSQL 与对象存储，执行当前 migration，再将
`env/commands/ingestion-control-runtime.env.example` 加载到 shell：

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

本地 image 使用同一 Dockerfile 的明确 target：

```bash
docker build --target api -f apps/ingestion-control/Dockerfile -t ingestion-control .
docker build --target worker -f apps/ingestion-control/Dockerfile -t ingestion-control-worker .
```

## 验证

```bash
pnpm ci:ingest
```
