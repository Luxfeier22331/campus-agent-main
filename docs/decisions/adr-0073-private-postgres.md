---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0073
status: accepted
created: 2026-07-12
updated: 2026-07-12
---

# ADR-0073 Private Postgres

## 背景

关系型数据已经收敛到自托管 CloudNativePG。集群内服务、Cloudflare Worker、一次性
schema Job 和运维读取面需要访问同一份权威数据，但不能公开 PostgreSQL，也不能让各
运行时共享数据库 owner 凭据。

## 决策

- Kubernetes 内的运行时通过 ClusterIP 和 CNPG CA 直接连接，使用 `verify-full`。
- `app-api` Worker 通过现有 Hyperdrive 绑定连接数据库，路径固定为
  `Worker -> Hyperdrive -> Workers VPC TCP Service -> cloudflared -> CNPG ClusterIP`。
- Workers VPC Service 复用集群现有的双副本 `cloudflared` 隧道，只开放 CNPG 5432，
  不新增数据库公网入口。
- `APP_API_DB` 与 `APP_API_DB_FRESH` 指向同一数据库和同一 `app_api` 角色；前者允许
  Hyperdrive 查询缓存，后者关闭查询缓存并只服务明确的写后读路径。
- CNPG `DatabaseRole` 为每个运行时创建独立登录角色。运行时只获得所需 schema、表和
  列权限；schema Job 使用 owner 连接，不通过 Hyperdrive。
- 缺少角色、CA、schema、权限或 VPC 连接时直接失败，不回退到旧数据库、公共地址或
  共享 owner 凭据。

## 数据所有权

- `apps/app-api` 拥有 `app_auth.*`、`chat.*` 和 browser-facing product schema。
- `apps/execution-control` 拥有 `runtime.agent_*` 工作流投影。
- `jobs/transport-publisher` 是 `campus_services.*` 的唯一发布写入边界；`app-api` 和
  execution-control 只读同一份 current release。
- `apps/ops-web` 使用受限列权限读取运行状态，并单独写入读取审计。
- Temporal、Hindsight、OpenObserve 使用各自数据库或角色，不共享产品运行时角色。

## 后果

- 不迁移旧托管数据库数据；当前 CNPG schema 可由 repo-owned installer 重建。
- Cloudflare 连接配置和 Kubernetes 网络策略必须同时允许私网数据库路径。
- CNPG CA 轮换、Hyperdrive 配置和 VPC Service 状态属于部署验证项，不写入产品代码
  fallback。

## 参考

- <https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/>
- <https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/>
- <https://developers.cloudflare.com/hyperdrive/configuration/tls-ssl-certificates-for-hyperdrive/>
