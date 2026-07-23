---
doc_type: data
owner_boundary: data-postgres
status: active
---

# PostgreSQL 所有权

## 文档边界

本文定义仓库自有 PostgreSQL 的逻辑 schema、角色和读写边界。字段由所属数据文档和可执行
schema 定义，连接拓扑见 `../architecture/system/data-plane.md`，部署方式和环境选择不在本文
维护。

## 角色

| 角色 | 运行所有者 | 权限边界 |
| --- | --- | --- |
| `campus_agent` | 数据库 bootstrap | schema 安装和授权，不用于常驻运行时 |
| `app_api` | `apps/app-api` | 产品数据读写、文档发布只读和获准运行摘要读取 |
| `execution_control` | `apps/execution-control` | 执行投影写入和获准校园服务读取 |
| `campus_services_publisher` | `jobs/transport-publisher` | `campus_services.*` 发布写入 |
| `docs_publish` | `jobs/docs-publish` | `docs.*` 发布写入 |
| `ops_web` | `apps/ops-web` | 获准排查投影的列级只读访问 |
| `execution_provider_config_reader` | `apps/execution-control` | 已激活 `execution_config.*` 读取 |
| `execution_provider_config_admin` | `apps/execution-control` | 配置 revision、验证和激活读写 |
| `ops_web_dining` | `apps/ops-web` | Dining 草稿、发布、回滚和评价治理 |
| `dining_sync` | `jobs/dining-sync` | Dining 来源观测、同步和复检 |

Temporal、Hindsight 和 Langfuse 使用自己的数据存储或登录角色，不共享产品运行时角色。外部
观测平台不获得产品 PostgreSQL 角色。

表中角色是权限主体，不等于都已具备环境登录凭据。当前数据库 base 将 `docs_publish` 保持为
`NOLOGIN` 授权主体；只有部署文档发布单元时，才由该发布单元同时交付可登录 DatabaseRole、Secret
和 Job。`ops_web_dining` 与 `dining_sync` 均由 Dining migration 单元交付，不由数据库平台或
Ops Web 核心发布单元预创建。`app_api` 是共享产品运行角色，Dining 只管理它在 `dining.*` 上的
权限。

## Schema 所有权

| Schema 或表族 | 写入所有者 | 主要读取方 |
| --- | --- | --- |
| `app_auth.*` | App API 身份模块 | App API |
| `chat.*` | App API 对话模块 | App API、获准 Ops Web 投影 |
| `profile.*` | App API 账号设置 | App API |
| `docs.*` | 文档发布任务 | App API、文档读取面 |
| `runtime.request_observability_fact` | App API 产品终态 | App API、Ops Web |
| `runtime.agent_*` | execution-control | execution-control |
| `execution_config.*` | execution-control 配置管理 | execution-control |
| `dining.*` | Dining 同步和 Ops Web | Ops Web、同步任务、App API 公开读取 |
| `campus_services.*` | 校园服务发布任务 | App API、execution-control |

ingestion registry 和来源事实由采集数据所有者维护，不并入产品 schema。各表字段、状态和保留
规则由所属数据文档或 schema 唯一维护。

## 访问规则

- 常驻运行时不使用 schema 管理或 migration 凭据；
- 每个运行时只获得完成其职责所需的表、列和操作权限；
- Provider Config 只能通过 execution-control 管理接口修改，Ops Web 不直连其 schema；
- App API 只读取 Dining 当前发布和公开评价，不拥有 Dining migration；
- Ops Web 的请求排查角色与 Dining 内容角色分离；
- Ops Web 核心授权不检查或修改 Dining schema；
- 不同所有者不共享 migration journal，也不通过双写复制同一事实；
- 对象 bytes、原始来源、工作流历史和供应商 trace 不进入这些 schema。

角色、grant、migration 和应用查询必须共同变化。新增数据库列不会自动进入其他所有者的读取
权限或 API 响应。强依赖 schema 的运行时在同一发布 Application 中拥有角色、Secret、migration
和 workload。嵌入宿主进程的可选领域能力由领域 Application 拥有 schema、专用角色、Secret 和
授权，宿主只使用 optional Secret 引用；该领域失败不得阻塞宿主的无关能力。数据库平台
Application 只维护数据库 owner 和无登录授权主体。

## 可执行来源

- App API schema：`apps/app-api/db/`、`apps/app-api/drizzle/`
- 执行投影与配置：`apps/execution-control/internal/`
- Ops Web 核心 read-model grant：`apps/ops-web/ops/db/`
- Dining schema 与 grant：`jobs/dining-sync/drizzle/`、`jobs/dining-sync/src/database-grants.ts`、
  `packages/domains/dining/src/schema.ts`
- 校园服务发布：`jobs/transport-publisher/`

## 相关文档

- `app-api/README.md`
- `durable-runtime.md`
- `dining.md`
- `../architecture/system/data-plane.md`
- `../architecture/system/k8s-runtime.md`
- `../decisions/adr-0073-postgres.md`
