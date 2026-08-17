---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0073
status: accepted
---
# ADR-0073 PostgreSQL

## 背景

自托管服务、Cloudflare Workers 和维护任务需要访问同一关系型数据，但数据库不能公开，
不同运行时也不能共享数据库管理凭据。

## 决策

- CloudNativePG 管理自托管 PostgreSQL；数据库没有公网入口。
- Kubernetes 内运行时通过 ClusterIP 和受验证的 TLS 直接连接。
- Cloudflare Worker 通过 Hyperdrive、Workers VPC Service 和受控 tunnel 连接 CNPG，
  不绕行公共数据库地址。
- App API 只使用一个关闭 query cache 的 Hyperdrive binding；连接池仍由 Hyperdrive 管理，不在
  应用中建立第二条数据库路径。
- 每个运行时使用独立登录角色和最小 schema/table/column 权限。schema 安装或迁移任务
  使用独立 schema 管理角色，不通过应用连接路径。
- 缺少私网连接、CA、角色、schema 或权限时失败关闭，不回退到旧数据库、公共地址或
  共享 schema 管理凭据。

具体 schema 所有者、角色授权和连接变量由数据文档、应用合同和环境仓维护。

## 后果

- CNPG、tunnel、Workers VPC 和 Hyperdrive 共同构成 Worker 私网数据库路径，任一环节都
  必须独立验证。
- CA 和凭据轮换属于环境操作，不通过产品代码中的回退逻辑隐藏。
- 服务间共享数据库实例不等于共享 schema 所有权或登录角色。

## 未采用方案

- **公开 PostgreSQL**：扩大攻击面且绕过私网访问控制。
- **每个运行时共享 schema 管理凭据**：无法独立轮换并隔离 schema 所有权。
- **把 Hyperdrive 当作第二数据库**：它只是 Worker 连接与可选查询缓存层。

## 相关文档

- `../data/postgres-ownership.md`
- `adr-0074-repository-boundary.md`
- <https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/>
