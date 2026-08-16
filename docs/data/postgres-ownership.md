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
| `app_api` | `apps/app-api` | 产品数据读写和获准运行摘要读取 |
| `execution_control` | `apps/execution-control` | 执行投影、模型配置读写和 Campus Docs 检索准入 |
| `ingestion_control` | `apps/ingestion-control` | 采集任务投影读写 |
| `notice_publisher` | `jobs/notice-publisher` | 规范化通知写入 |
| `campus_docs_index_publisher` | `jobs/campus-docs-index-publisher` | Campus Docs 当前索引单行绑定替换 |
| `ops_web` | `apps/ops-web` | 获准运行投影的列级只读访问、Dining 内容维护和内部门户凭据读写 |

Temporal、Hindsight 和 Langfuse 使用自己的数据存储或登录角色，不共享产品运行时角色。外部
观测平台不获得产品 PostgreSQL 角色。

表中角色是权限主体，不等于都已具备环境登录凭据。`ops_web` 是 Ops Web 的唯一运行角色，Dining
不创建第二个角色或连接。

## Schema 所有权

| Schema 或表族 | 写入所有者 | 主要读取方 |
| --- | --- | --- |
| `app_auth.*` | App API 身份模块 | App API |
| `chat.*` | App API 对话模块 | App API、获准 Ops Web 投影 |
| `profile.*` | App API 账号设置 | App API |
| `campus_groups.sections`、`campus_groups.groups` | App API 同好群模块 | App API、通过内部接口访问的 Ops Web |
| `runtime.request_observability_fact` | App API 产品终态 | App API |
| `execution_control.agent_*`、`execution_control.conversation_run_locks`、`execution_control.personal_memory_*` | execution-control | execution-control、获准 Ops Web 投影 |
| `execution_control.model_settings` | execution-control 配置管理 | execution-control |
| `campus_docs_serving.current_index` | Campus Docs index publisher | execution-control、Campus Docs index publisher |
| `ingestion_control.tasks` | ingestion-control | ingestion-control |
| `notices.*` | notice-publisher | App API 只读业务表 |
| `dining.*` | Ops Web | Ops Web、App API 公开读取 |
| `internal_portal.credentials`、`internal_portal.automation_tokens` | Ops Web | Ops Web |

ingestion registry 和来源事实由采集数据所有者维护，不并入产品 schema。各表字段、状态和保留
规则由所属数据文档或 schema 唯一维护。

`app_auth.*` 包含 Better Auth 核心表、启用插件的表以及 App API 账号生命周期表。Better Auth
表由 `apps/app-api/src/db/schema/auth.ts` 描述，全部 App API 自有表由 `managed.ts` 汇总，并使用
`drizzle.app_api_migrations` 这一条 ledger 迁移；Better Auth 运行时不执行 DDL，也不维护第二条
migration 记录。

Campus Web 静态文档发布只使用对象存储和构建产物。独立 Campus Docs index publisher 使用专用角色
替换 `campus_docs_serving.current_index` 单行绑定，不访问产品 schema；execution-control 只读该表。
该角色的 Secret 只保存 `username` / `password`，数据库地址、库名和 TLS 参数复用 schema workload 的
标准 `PG*` ConfigMap，不创建第二套数据库 URL 合同。
旧 `docs.*` schema 由 App API migration 删除，历史 migration 不构成当前所有权。

## 迁移合同

每个 schema 所有者只维护一条追加式 migration ledger：

| 所有者 | 可执行 schema | Migration ledger |
| --- | --- | --- |
| App API | `apps/app-api/src/db/schema/managed.ts` 与 `apps/app-api/drizzle/` | `drizzle.app_api_migrations` |
| execution-control | `apps/execution-control/internal/schemamigrations/` | `public.execution_control_migrations` |
| ingestion-control | `apps/ingestion-control/migrations/` | `ingestion_control.schema_migrations` |
| 通知 | `jobs/notice-publisher/migrations/` | `notices.schema_migrations` |
| Ops Web | `packages/domains/dining/src/schema.ts`、`apps/ops-web/ops/db/internal-portal-schema.ts` 与 `apps/ops-web/drizzle/` | `drizzle.ops_web_dining_migrations`（保留历史名称） |

- 已应用 migration 不得修改、重排或重新生成；结构变化新增下一条 migration。Drizzle 的 SQL、
  journal 和 snapshot 必须成套提交，Goose 的 SQL 与 Go migration 版本同样只追加；
- baseline 只描述工具接管前的已知结构，不是当前 schema。首次接管只能接受空库或经过测试的精确
  前置结构；没有 ledger 的未知部分状态必须失败，不能用 `IF NOT EXISTS` 拼成表面成功；
- 自定义 migration 只用于普通 SQL 不能表达的数据转换。Provider legacy 转换因此由版本化 Goose
  Go migration 执行；运行时 Store、Better Auth 和业务 bootstrap 不执行 DDL；
- grants 在 migration 成功后由 schema Job 独立应用，Dining 初始草稿在 schema 和 grants 完成后
  独立写入。重跑 grants 或 bootstrap 不得代替 migration；
- `IF EXISTS`、`IF NOT EXISTS` 只用于 migration 已明确支持且由集成测试覆盖的前置状态，不作为
  未知结构、缺失对象或失败 migration 的 fallback；
- 修改 migration 时必须运行所属 PostgreSQL Testcontainers 套件，至少覆盖空库、受支持历史升级、
  未知部分状态、重复执行及运行角色权限；Drizzle 所有者还要覆盖已应用 hash 校验。

`campus_docs_serving` 的 DDL 和授权属于 execution-control 的 migration ledger；publisher 只写业务
记录，不执行 DDL 或维护第二条 migration ledger。

## 访问规则

- 常驻运行时不使用 schema 管理或 migration 凭据；
- 每个运行时只获得完成其职责所需的表、列和操作权限；
- `run-projection-schema` 在执行投影、个人记忆状态表和模型配置全部安装后，将运行角色的
  `execution_control` 权限收敛为 schema `USAGE`，以及所属表的 `SELECT`、`INSERT`、`UPDATE`、
  `DELETE`。该角色不获得 schema `CREATE`、表 `TRUNCATE`、`REFERENCES`、`TRIGGER`，也不能访问
  App API 所有的 `runtime.request_observability_fact`；
- execution-control 表所有者只向 `ops_web` 授予 `agent_runs` 和 `agent_step_attempts` 当前运维
  投影使用的精确列读取。Ops Web migration 不创建、扩大或收回 execution-control 表权限；
- schema Job 必须校验上述固定角色的有效权限。常驻 execution-control 的运行投影和个人记忆
  状态健康检查必须实际读取所属表，不能用 PostgreSQL catalog 可见性代替运行角色的数据访问能力；
- 在线模型配置只能通过 execution-control 管理接口修改，Ops Web 不直连其 schema；
- `campus_docs_index_publisher` 对 `campus_docs_serving.current_index` 只有 `SELECT`、`INSERT`、
  `UPDATE`；`execution_control` 对该表只有 `SELECT`；
- `execution_control.model_settings` 的首次安装由低 wave 的 `run-projection-schema` Job 执行。
  该 Job 使用环境仓交付的 schema-install DSN 和现有 provider keyring；常驻 runtime 只使用
  `execution_control` DSN，不执行迁移。
- 从旧 `active_bundle`、`profiles` 和 `connection_revisions` 切换时，Job 在单一事务和 advisory
  lock 下解密旧 AAD，以 `execution_config.model_settings:<kind>` 这一不可变 AAD v1 重加密当前
  LLM 与 Embedding，验证写入结果后删除七张旧表。任一步失败都会连同 v3 的新表和数据转换整体
  回滚；v4 表移动和 grants 由后续 migration 阶段执行。
- 旧结构不完整、当前表已有数据、缺少 active bundle、缺少 keyring、profile 未验证或存在未知依赖
  时切换失败。Provider legacy 转换不保留双写、运行时双读或 fallback。
- 没有旧结构时，当前表可以为空或只配置一个 kind；schema 安装不把业务配置完整性变成部署门禁。
  `llm` 和 `embedding` 分别由消费它们的运行路径检查并失败。
- Goose v4 将 execution-control 的 12 张运行表和 `model_settings` 原位移动到
  `execution_control`。`runtime` 与 `execution_config` 下的同名对象暂为不可写兼容视图，只支持
  切换期间的旧读取；旧 writer 不获得 DML。活跃环境完成停写迁移、同 revision 部署和读取验证后，
  才能由后续 migration 删除这些视图及空的 `execution_config` schema；源码合并本身不证明环境已
  完成该清理。
- Goose v5 在已移动的 `execution_control.model_settings` 上暂时新增 `embedding_space_id`，并创建
  `campus_docs_serving.current_index`；Goose v6 删除模型设置中的向量字段以及当前索引中不再由配置管理的
  `embedding_model`、`embedding_provider`。已应用 v3 的数据库通过 v4、v5、v6 顺序升级，不会重跑或
  改写 v3。
- App API 读取 Dining 当前发布地图、菜单和公开评价；可创建或删除学生自己的评价并创建举报，
  但不能读取地图草稿和评价修改历史，也不能修改地图或菜单；
- App API 只能读取 `notices` 的通知、资源 metadata、类型、组织和领域业务表，不能读取
  `notices.schema_migrations` 或写入该 schema；
- Ops Web 使用同一 `ops_web` 角色维护 Dining 地图、菜单、评价、举报和评价修改历史；
- Ops Web 使用同一角色读写 `internal_portal.credentials` 和
  `internal_portal.automation_tokens`；App API 和其他运行角色没有该 schema 权限。token 明文保留是
  为满足 Ops Web 的重复 reveal 合同，不作为通用 Secret 管理能力；
- 不同所有者不共享 migration journal，也不通过双写复制同一事实；
- 对象 bytes、原始来源、工作流历史和供应商 trace 不进入这些 schema。

角色、grant、schema 安装和应用查询必须共同变化。新增数据库列不会自动进入其他所有者的读取
权限或 API 响应。拥有 schema 的应用同时交付安装命令和授权；常驻 workload 只使用运行角色。
数据库平台只维护数据库 owner 和明确需要的无登录授权主体。

## 可执行来源

- App API schema：`apps/app-api/src/db/schema/`、`apps/app-api/ops/db/`、`apps/app-api/drizzle/`
- 通知 schema 与授权：`jobs/notice-publisher/migrations/`
- 执行投影与配置：`apps/execution-control/internal/schemamigrations/`
- Ops Web schema：`packages/domains/dining/src/schema.ts`、
  `apps/ops-web/ops/db/internal-portal-schema.ts`、`apps/ops-web/drizzle/`
- Ops Web 授权：`apps/ops-web/ops/db/`

## 相关文档

- `app-api/README.md`
- `durable-runtime.md`
- `../product/dining.md`
- `../architecture/system/data-plane.md`
- `../architecture/system/k8s-runtime.md`
- `../decisions/adr-0073-postgres.md`
