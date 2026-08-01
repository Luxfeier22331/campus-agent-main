---
doc_type: runbook
owner_boundary: apps/ingestion-control
status: active
---

# 采集运行

## 范围

本文说明注册 Rust 任务、内部门户文件发布 workflow 和本地通知命令。系统没有来源 callback、
独立 run ledger、文件发布离线发布流或自动 query target 发布。

## 前置条件

- ingestion migration 可以访问 PostgreSQL；
- source 与 derived bucket 使用各自对象存储凭据；
- Temporal namespace 可用；
- ingestion-control 与 source-collector 来自同一 source revision；
- `configs/ingestion` 中的 Rust registry 已通过校验；
- 使用内部门户本地命令或显式 worker 时，已从 Ops Web 取得目标 TGC 并通过直接变量配置。

## 数据库与本地进程

```bash
pnpm --filter ingestion-control schema:bootstrap
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

数据库 TLS 与运行变量见 `env/commands/ingestion-control-runtime.env.example`。migration 使用
advisory lock，并在 `ingestion_control.schema_migrations` 校验已应用 SQL 的摘要。当前 migration
会删除旧 source-collector/TypeScript 任务、父 pipeline 字段、离线发布表和旧通知边界表。

## 注册任务

调用方先把输入写入对象存储并计算摘要，再提交 `ingestion_task_envelope.v3`：

```bash
curl -fsS \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@${INGESTION_TASK_ENVELOPE_PATH}" \
  http://127.0.0.1:8000/internal/ingestion/tasks
```

任务必须由当前 registry 声明为 Rust kernel。canonical workflow ID 为 `ingestion/<task_id>`。
相同 task ID 只有在冻结输入一致时幂等；不同输入返回冲突。失败或取消的任务通过 Ops Web 使用
新 task ID 重试。

## 文件发布

文件发布只接受精确 ID，一次最多 50 个：

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "X-Operator-Id: operator@example.edu" \
  -H "Content-Type: application/json" \
  -d '{"request_id":"files-20260717","file_release_ids":[646,647]}' \
  http://127.0.0.1:8000/internal/ingestion/operations/internal-portal/file-releases
```

响应为每个 ID 返回独立 workflow ID。调用方用这些 ID 调用
`/internal/ingestion/operations/internal-portal/file-releases/status`，全部进入 Temporal 终态后停止
轮询。当前 Ops Web 不提供该操作入口。文件发布不创建 ingestion task；失败后使用新的 request ID
重新提交需要的文件 ID。

成功结果只在 source bucket 保存 `file` 与 `source.json`，具体合同见
`docs/contracts/internal-portal-file-release.md`。

## 本地通知采集

```bash
pnpm dev:init
pnpm --filter source-collector notice:sync
pnpm --filter source-collector notice:status
pnpm --filter source-collector notice:backfill -- --start-date 2026-01-01
```

`dev:init` 启动本地 MinIO、确保共享 source bucket 存在，并生成对象存储 `.env.local`。sync 与
backfill 还需要开发者在未跟踪的 `.env` 中提供当前 TGC，status 只读对象存储状态；三者都不需要
PostgreSQL、ingestion-control API 或 Temporal。首次同步只建立当前最大 ID；后续采集新增通知；
历史回填必须显式提供日期。同一 `site_id` 的 sync 与 backfill 不得并发执行。通知对象和
`_state.json` 边界都写入 source bucket。

## Kubernetes

`infra/k8s/ingestion-runtime/base/runtime` 包含 API、migration 和两个 worker。环境 overlay 必须
提供数据库、对象存储、Temporal 和镜像摘要；源码 base 不创建认证 schedule，也不向
source-collector 注入 TGC。

source-collector 只能获得 source bucket 凭据。所有容器使用 non-root、只读 root filesystem；
临时下载文件只写 `/tmp`。内部门户 TGC 由 Ops Web 保存和定时检查；需要采集时由开发者在显式
本地进程中选择并传入，Kubernetes base 本身不开放已认证的文件发布执行。

## 排查

注册任务先检查 Temporal workflow、Rust Activity 和 PostgreSQL 投影。文件发布先检查返回的
workflow ID、source-collector Activity、门户响应及两个固定 source 对象。通知先查看命令错误、
通知对象和 `_state.json`，不要手工推进边界来伪装成功。

认证错误按 `portal-auth.md` 替换 TGC。对象摘要或 schema 不一致时保留明确失败，不能改写为部分
成功。

## 验证

```bash
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:ingestion-control-postgres
pnpm ci:infra
```

这些检查验证源码、合同、隔离数据库 migration 和 Kubernetes 期望配置，不证明集群已应用或
真实门户可用。Ops Web 凭据的环境检查见 `portal-auth.md`。
