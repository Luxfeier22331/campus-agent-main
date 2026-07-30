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
| `execution_control` | `apps/execution-control` | 执行投影、模型配置读写和获准校园服务读取 |
| `docs_publish` | `jobs/docs-publish` | `docs.*` 发布写入 |
| `ops_web` | `apps/ops-web` | 获准运行投影的列级只读访问，以及 Dining 内容维护 |

Temporal、Hindsight 和 Langfuse 使用自己的数据存储或登录角色，不共享产品运行时角色。外部
观测平台不获得产品 PostgreSQL 角色。

表中角色是权限主体，不等于都已具备环境登录凭据。当前数据库 base 将 `docs_publish` 保持为
`NOLOGIN` 授权主体；只有部署文档发布单元时，才由该发布单元同时交付可登录 DatabaseRole、Secret
和 Job。`ops_web` 是 Ops Web 的唯一运行角色，Dining 不创建第二个角色或连接。

## Schema 所有权

| Schema 或表族 | 写入所有者 | 主要读取方 |
| --- | --- | --- |
| `app_auth.*` | App API 身份模块 | App API |
| `chat.*` | App API 对话模块 | App API、获准 Ops Web 投影 |
| `profile.*` | App API 账号设置 | App API |
| `campus_groups.sections`、`campus_groups.groups` | App API 同好群模块 | App API、通过内部接口访问的 Ops Web |
| `docs.*` | 文档发布任务 | App API、文档读取面 |
| `runtime.request_observability_fact` | App API 产品终态 | App API |
| `runtime.agent_*` | execution-control | execution-control |
| `execution_config.*` | execution-control 配置管理 | execution-control |
| `dining.*` | Ops Web | Ops Web、App API 公开读取 |
| `campus_services.*` | 当前无常驻写入方；`app-api-schema` 管理结构 | App API、execution-control |

ingestion registry 和来源事实由采集数据所有者维护，不并入产品 schema。各表字段、状态和保留
规则由所属数据文档或 schema 唯一维护。

`app_auth.*` 包含 Better Auth 核心表、启用插件的表以及 App API 账号生命周期表。Better Auth
表由 `apps/app-api/src/db/schema/auth.ts` 描述，全部 App API 自有表由 `owned.ts` 汇总，并使用
`drizzle.app_api_migrations` 这一条 ledger 迁移；Better Auth 运行时不执行 DDL，也不维护第二条
migration 记录。

## 访问规则

- 常驻运行时不使用 schema 管理或 migration 凭据；
- 每个运行时只获得完成其职责所需的表、列和操作权限；
- `run-projection-schema` 在执行投影和个人记忆状态表全部安装后，将 `execution_control` 的
  `runtime` 权限收敛为 schema `USAGE`，以及所属十三张表的 `SELECT`、`INSERT`、`UPDATE`、
  `DELETE`。该角色不获得 schema `CREATE`、表 `TRUNCATE`、`REFERENCES`、`TRIGGER`，也不能访问
  App API 所有的 `runtime.request_observability_fact`；
- schema Job 必须校验上述固定角色的有效权限。常驻 execution-control 的运行投影和个人记忆
  状态健康检查必须实际读取所属表，不能用 PostgreSQL catalog 可见性代替运行角色的数据访问能力；
- 在线模型配置只能通过 execution-control 管理接口修改，Ops Web 不直连其 schema；
- `execution_config.model_settings` 的首次安装由低 wave 的 `run-projection-schema` Job 执行。
  该 Job 使用环境仓交付的 schema-install DSN 和现有 provider keyring；常驻 runtime 只使用
  `execution_control` DSN，不执行迁移。
- 从旧 `active_bundle`、`profiles` 和 `connection_revisions` 切换时，Job 在单一事务和 advisory
  lock 下解密旧 AAD，以 `execution_config.model_settings:<kind>` 重加密当前 LLM 与 Embedding，
  验证写入结果后删除七张旧表并应用当前权限。任一步失败都会连同新表和权限变化整体回滚。
- 旧结构不完整、当前表已有数据、缺少 active bundle、缺少 keyring、profile 未验证或存在未知依赖
  时切换失败。系统不保留双写、双读、运行时 fallback 或后续 contract 阶段。
- 没有旧结构时，当前表可以为空或只配置一个 kind；schema 安装不把业务配置完整性变成部署门禁。
  `llm` 和 `embedding` 分别由消费它们的运行路径检查并失败。
- App API 读取 Dining 当前发布地图、菜单和公开评价；可创建或删除学生自己的评价并创建举报，
  但不能读取地图草稿和评价修改历史，也不能修改地图或菜单；
- Ops Web 使用同一 `ops_web` 角色维护 Dining 地图、菜单、评价、举报和评价修改历史；
- 不同所有者不共享 migration journal，也不通过双写复制同一事实；
- 对象 bytes、原始来源、工作流历史和供应商 trace 不进入这些 schema。

角色、grant、schema 安装和应用查询必须共同变化。新增数据库列不会自动进入其他所有者的读取
权限或 API 响应。拥有 schema 的应用同时交付安装命令和授权；常驻 workload 只使用运行角色。
数据库平台只维护数据库 owner 和明确需要的无登录授权主体。

## 可执行来源

- App API schema：`apps/app-api/src/db/schema/`、`apps/app-api/db/`、`apps/app-api/drizzle/`
- 执行投影与配置：`apps/execution-control/internal/`
- Ops Web 排查授权与 Dining schema：`apps/ops-web/ops/db/`
- 校园服务读取表与授权：`apps/app-api/db/shared-product-schema/`、`apps/app-api/ops/db/`

## 相关文档

- `app-api/README.md`
- `durable-runtime.md`
- `../product/dining.md`
- `../architecture/system/data-plane.md`
- `../architecture/system/k8s-runtime.md`
- `../decisions/adr-0073-postgres.md`
