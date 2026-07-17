---
doc_type: data
owner_boundary: data-postgres
status: active
---

# PostgreSQL 所有权

## 文档边界

本文定义 repo-owned PostgreSQL 的连接、角色、逻辑 schema 和安装边界。表字段由各 owner
数据文档和可执行 schema 定义；环境是否已部署成功由 GitOps 状态和运行验证决定。

## 部署拓扑

- Kubernetes 使用一套自托管 CloudNativePG 集群。
- 产品关系型数据位于 `campus_agent` 数据库，并按逻辑 schema 分域。
- 集群内运行时通过 ClusterIP 直连，挂载 CNPG CA 并使用 `verify-full`。
- `app-api` Worker 通过 Hyperdrive 和 Workers VPC TCP Service 访问同一数据库。
- schema installer 使用 owner 连接直连 CNPG，不通过 Hyperdrive。
- PostgreSQL 不暴露公网入口，也不提供旧数据库或公共地址 fallback。

完整连接决策见 `docs/decisions/adr-0073-postgres.md`。

## 角色

| 角色 | 所有者 | 权限边界 |
| --- | --- | --- |
| `campus_agent` | CNPG bootstrap | schema 安装和授权，不用于常驻 runtime |
| `app_api` | `apps/app-api` | app-owned runtime DML、`docs.*` 只读；只能访问允许的 `runtime.*` 表 |
| `execution_control` | `apps/execution-control` | 执行投影写入和班车读取 |
| `campus_services_publisher` | `jobs/transport-publisher` | `campus_services.*` 发布写入 |
| `docs_publish` | `jobs/docs-publish` | `docs.*` release 投影发布写入 |
| `ops_web` | `apps/ops-web` | 明确列的读取和 observability read-audit 写入 |
| `ops_web_provider_config` | `apps/ops-web` | `provider_config.*` 候选和验证结果读写 |
| `ops_web_dining` | `apps/ops-web` | Dining 草稿、发布、回滚和评价治理 |
| `dining_sync` | `jobs/dining-sync` | Dining 来源观测、评价同步和复检 |
| `ops_audit_maintenance` | maintenance Job | 只执行审计清理函数 |

Temporal、Hindsight 和 OpenObserve 使用各自数据库或登录角色，不共享产品运行时角色。
CNPG `DatabaseRole` 和部署 Secret 管理角色密码；应用 schema 只负责表、函数和 grant。

## Schema 所有权

- `app_auth.*`、`chat.*`、`docs.*`、`identity.*`、`profile.*`、`campus_services_ops.*` 和
  `observability.*` 的 schema 合同由 `apps/app-api` 安装；`docs.*` 由 `jobs/docs-publish`
  写入，app-api 只读。
- `provider_config.*` 的领域合同和运行写入由 `packages/domains/provider-config` 与
  `apps/ops-web` 拥有。历史 App API journal 完成表交接并撤销 `app_api` 权限；后续字段变更不得
  回到 app-api runtime 模块。
- `dining.*` 的 schema 和 migration 由 `jobs/dining-sync` 拥有；Ops Web 拥有领域运维写入，
  app-api 只读取 `publication`、`releases` 和公开 `reviews`。
- `app_auth.*` 与 `chat.*` 通过共享产品 SQL 基线安装，不属于 App API Drizzle journal；
  其余 app-owned schema 由 App API migration 管理。
- `runtime.request_observability_fact` 由 app-api schema 安装并由运行链路更新。
- `runtime.agent_*` 由 execution-control schema owner 管理；`app_api` 不读取这些表。
- `campus_services.*` 由 `jobs/transport-publisher` 安装和发布；app-api 状态页与
  execution-control tool 读取同一个 current release。
- ingestion registry 和 source truth 由 ingestion owner 管理，不并入 app-api migration。

已退役的 `runtime.request_execution`、`runtime.projection_outbox`、operator request
projection、Temporal sampler projection 和 worker-autoscaler projection 不属于当前 schema。

## 安装与 journal

- `jobs/app-api-schema` 先收敛 Better Auth `app_auth.*` 与
  `chat_current.sql`，再执行 immutable App API Drizzle journal，最后应用运行角色
  grant。这个顺序同时支持干净数据库和已有 baseline 数据升级。
- app-api Drizzle journal 固定为 `drizzle.app_api_migrations`。
- `apps/app-api/drizzle/0000_initial.sql` 是已发布的 App API 初始基线；
  `apps/app-api/db/shared-product-schema/chat_current.sql` 是 `chat.*` 共享产品基线。
- `jobs/transport-publisher install-schema` 安装 `campus_services.*` 并应用 publisher、
  app-api 和 execution-control 的最小权限；Ops Web 不读取该 schema。
- App API schema installer 为 `docs_publish` 应用 `docs.*` 最小 DML grant，并撤销 app-api
  对该 schema 的写权限；`jobs/docs-publish` 不创建或迁移 schema。
- App API schema installer 在交接 migration 后为 `ops_web_provider_config` 应用
  `provider_config.*` 最小 DML grant，并撤销 `app_api` 的全部访问。
- `jobs/dining-sync migrate` 使用独立 migration 凭据重建 `dining.*` 并为 `dining_sync`、
  `ops_web_dining` 和 `app_api` 配置最小权限；常驻运行时角色不得创建 schema。
- execution-control 使用独立的 run-projection schema installer 和 journal。
- installer 必须可重复执行；缺少角色、表、CA 或权限时失败，不自动做破坏性修复。
- `0000_initial.sql` 和其 snapshot 是已发布 baseline，不得重写。后续变更使用新
  journal entry；migration integration 必须证明保留表中的现有行不会丢失。

## Hyperdrive

- `APP_API_DB` 与 `APP_API_DB_FRESH` 指向同一 `campus_agent` 数据库和 `app_api` 角色。
- `APP_API_DB` 承担普通读取并允许 Hyperdrive 查询缓存。
- `APP_API_DB_FRESH` 关闭查询缓存，只用于明确列出的写后读路径。
- 两个 binding 不是双写、双库或故障回退。

## 环境变量

- 根 `CAMPUS_SHARED_POSTGRES_URL` 和 `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` 只服务本地命令
  与 owner 工具，不是 Kubernetes 部署 truth。
- app-local env 只保存该 app 直接消费的连接，例如
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB` 和
  `APP_API_OPERATOR_DATABASE_URL`。
- Kubernetes 连接由 ConfigMap 中的固定内部主机、CNPG CA 和角色 Secret 组装；Secret
  不重复保存可由这些字段确定的 DSN。

## 不变量

- runtime 不使用 schema owner 凭据。
- owner 之间不共享 migration journal。
- 对象 bytes 进入 S3-compatible object storage，不进入 PostgreSQL。
- 缺少私网连接时不公开数据库。
- 代码中的 schema、GitOps DatabaseRole、Secret 和网络策略必须一起变更并一起验证。

## 相关文档

- `docs/data/app-api/README.md`
- `docs/architecture/system/data-plane.md`
- `docs/architecture/system/k8s-runtime.md`
- `docs/decisions/adr-0073-postgres.md`
