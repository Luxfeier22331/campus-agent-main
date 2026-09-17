---
doc_type: data
owner_boundary: data-postgres
status: active
---

# PostgreSQL 所有权

## 文档边界

本文定义仓库自有 PostgreSQL 的逻辑 schema、角色和读写边界。字段由所属数据文档和可执行
schema 定义，连接拓扑见 [采集数据面](../architecture/system/data-plane.md)，部署方式和环境选择不在本文
维护。

## 角色

下表是当前实现中的权限主体清单，不是“每个运行时必须一个角色”的通用规则。角色按数据所有权、
信任边界和生命周期决定；同一边界可以共享角色，只有存在独立授权或运维边界时才拆分。调整现有
角色、schema 或 Secret 属于独立的数据库/环境实施任务，本文件的治理规则不自动改变当前部署。

| 角色 | 运行所有者 | 权限边界 |
| --- | --- | --- |
| `campus_agent` | 数据库 schema 与显式 bootstrap Job | schema 安装、授权和一次性业务初始化，不用于常驻运行时 |
| `app_api` | `apps/app-api` | 产品数据读写和获准运行摘要读取 |
| `execution_control` | `apps/execution-control` | 执行投影和个人记忆状态读写 |
| `model_config` | `apps/model-config` | 当前具名模型配置与加密凭据读写 |
| `notice_publisher` | `jobs/notice-publisher` | 通知规范化写入；部署 Job 复用 `campus_agent` |
| `ops_web` | `apps/ops-web` | 获准运行投影的列级只读访问、Dining 内容维护和内部门户凭据及 automation token 读写 |

Temporal、Hindsight 和 Langfuse 使用自己的数据存储或登录角色，不共享产品运行时角色。外部
观测平台不获得产品 PostgreSQL 角色。

表中角色是权限主体，不等于都已具备环境登录凭据。`ops_web` 是 Ops Web 的唯一运行角色，Dining
不创建第二个角色或连接。

数据库角色生命周期由 CNPG 声明负责：当前角色由 `DatabaseRole` 资源声明，退役角色由
`infra/k8s/data-postgres/base/cluster.yaml` 中的 `spec.managed.roles` 以 `ensure: absent` 声明。
以下角色不是当前权限主体，只保留为退役清单，防止历史资源或人工操作重新创建它们：

| 退役角色 | 退役原因 |
| --- | --- |
| `campus_docs_index_publisher` | 发布任务已复用 `execution_control` 技术身份 |
| `docs_publish` | 旧发布路径已退役 |
| `execution_provider_config_admin` | 旧 Provider Config 管理路径已退役 |
| `execution_provider_config_reader` | 旧 Provider Config 读取路径已退役 |
| `ingestion_control` | ingestion-control 服务与凭据路径已退役 |

`campus-agent-schema` 只负责 schema、migration 和授权，不执行 `DROP ROLE`；Argo CD prune 只清理
Kubernetes 资源，也不会替代 CNPG 对 PostgreSQL 角色的对账。退役声明在所有受管环境确认角色已消失、
且仓库不存在重新创建来源前保持有效；之后才重新评估是否移除对应的负向声明。

## Schema 所有权

| Schema 或表族 | 写入所有者 | 主要读取方 |
| --- | --- | --- |
| `app_auth.*` | App API 身份模块 | App API |
| `chat.*` | App API 对话模块 | App API、获准 Ops Web 投影 |
| `profile.*` | App API 账号设置 | App API |
| `campus_groups.sections`、`campus_groups.groups` | App API 同好群模块 | App API、通过内部接口访问的 Ops Web |
| `runtime.request_observability_fact` | App API 产品终态 | App API |
| `execution_control.agent_*`、`execution_control.conversation_run_locks`、`execution_control.personal_memory_*`、`execution_control.owner_deletion_fences` | execution-control | execution-control、获准 Ops Web 投影、App API 的两列运行状态摘要 |
| `model_config.model_configs` | Model Config | Model Config；其他消费者只通过内部 HTTP 合同 |
| `campus_docs_serving.current_index` | Campus RAG serving（统一 publisher 复用 `execution_control` 技术身份写入） | Campus RAG publisher、execution-control Campus Search |
| `notices.*` | notice-publisher（部署 Job 复用 `campus_agent`） | App API 只读业务表 |
| `dining.*` | Ops Web | Ops Web、App API 公开读取 |
| `transport.*` | Ops Web；空库 baseline 由 Ops Web bootstrap 写入 | App API 公开 projection、Ops Web |
| `internal_portal.credentials`、`internal_portal.automation_tokens` | Ops Web | Ops Web；internal-portal-collection 只通过内部解析 API 消费结果 |

ingestion registry 和来源事实由采集数据所有者维护，不并入产品 schema。各表字段、状态和保留
规则由所属数据文档或 schema 唯一维护。

`app_auth.*` 包含 Better Auth 核心表、启用插件的表以及 App API 账号生命周期表。Better Auth
表由 `apps/app-api/src/db/schema/auth.ts` 描述，全部 App API 自有表由 `managed.ts` 汇总。可执行 DDL
与其他产品 schema 一起进入 `campus-agent-schema`；Better Auth 运行时不执行 DDL。

个人记忆的调用租约、命令回执和 owner fence 只由
`execution_control.personal_memory_call_leases`、`execution_control.personal_memory_command_receipts` 和
`execution_control.personal_memory_owner_fences` 承载。历史遗留的 `runtime.*` 兼容 View 无当前消费者，
由统一 migration `0002_remove_runtime_personal_memory_compat_views` 删除，不改变底层表、数据或权限。

Campus Web 静态文档发布只使用对象存储和构建产物。Campus RAG serving 逻辑上拥有
`campus_docs_serving.current_index` 单行绑定；唯一 current pointer writer 是
`jobs/campus-rag-index-publisher`，继续复用 `execution_control` 数据库身份读取并写入该绑定。Docs 和
Notice Chunk/Embedding builder 不写入该表。在线 execution-control 的 Campus Search 也使用该身份读取
当前绑定，但在线代码路径只消费该记录，不承担发布写入职责。由于 publisher 与在线 execution-control
共享技术身份，数据库 ACL 不能进一步区分两条进程路径；当前不因此创建独立数据库角色、连接字符串或
Secret。
旧 `docs.*` schema 由 App API migration 删除，历史 migration 不构成当前所有权。
通知 schema 与显式发布 Job 同样复用既有 `campus_agent` owner Secret；部署环境不需要
`notice_publisher` 登录或密码。班车 baseline 由现有 Ops Web bootstrap Job 使用 `ops_web` 连接写入。

## 迁移合同

数据库安装和后续升级只有一个可执行 DDL 入口：`jobs/campus-agent-schema`。它以 `campus_agent` 连接，
使用 PostgreSQL advisory lock，并把全部产品 schema 记录在
`drizzle.campus_agent_migrations`。逻辑数据所有权和运行角色权限仍按上节划分；共享 migration ledger
不表示应用之间共享写权限。

- `migrations/20260827151741_0000_campus_agent_baseline/migration.sql` 是 schema-only 的最终结构基线，不包含校园群组、测试
  用户、通知分类、Dining 草稿或其他业务数据；这些内容由独立 seed 写入；
- 已应用的统一 migration 不得修改或重排。结构变化更新所属声明式 schema，并在
  `jobs/campus-agent-schema/migrations/` 追加下一条带时间戳和序号的 SQL 目录；不再新增领域 ledger、journal 或 snapshot；
- migrator 只接受标准 `PG*` 环境变量，运行用户必须是 `campus_agent`。常驻 Store、Better Auth、
  publisher 和业务 bootstrap 不执行 DDL；
- 已使用统一 ledger 的 v0 数据库原位升级到 Drizzle ORM `1.0.0-rc.4` 的具名记录，保留原 ID、hash 和
  `created_at`，按缺失名称补跑 SQL，不再以最大时间戳过滤；已有记录与本地 SQL 不符时明确失败；
- 不接管仍使用领域 runner 的旧数据库。发现 `drizzle.app_api_migrations`、
  `drizzle.ops_web_dining_migrations`、`public.execution_control_migrations`、
  `model_config.schema_migrations`、`notices.schema_migrations` 或 `execution_config` 时明确失败；
- 应用自有 migration 文件、runner 和 legacy integration profile 已退役，不构成线上 upgrade 合同；线上统一
  使用 schema Job 按环境 revision 应用当前结构；源码仓不直接修改在线数据库；
- `0002_remove_runtime_personal_memory_compat_views` 只删除无消费者的 `runtime.*` 个人记忆兼容 View，
  不删除 `execution_control.personal_memory_*` 表或其数据；
- `status` 只读比较具名历史和 SQL hash，返回具体 `pendingMigrations`；旧 ledger 即使数量相等也不能
  报 `current`。`migrate` 在同一 advisory lock 内检查历史、执行原生 migrator，并确认没有遗漏后才成功；
- `pnpm --dir jobs/campus-agent-schema test:migration-integration` 使用隔离 PostgreSQL 验证空库、旧统一
  ledger（含遗漏 migration）、重复/并发执行、关键 ACL、未知历史拒绝和 SQL 失败回滚/重试。

`campus_docs_serving` 与其他 schema 共用统一 ledger；publisher 只写业务记录，不执行 DDL。

## 数据生命周期

| 数据 | 逻辑 owner | 生命周期与清理责任 |
| --- | --- | --- |
| 用户、会话、原始执行输入 | App API | 账号生命周期；由 App API 删除任务清理 |
| execution run/event/step/attempt/result projection | execution-control | 账号删除完成前保留，删除时 cascade 清理 |
| `owner_deletion_fences(state=deleted)` | execution-control | 保留最小 tombstone，阻止 owner 复活；不含用户内容 |
| Temporal history | Temporal/platform | 按平台 retention；不由 PostgreSQL 删除任务即时清理 |
| Hindsight personal memory | Hindsight；execution-control 推进删除命令 | 账号清除合同；execution-control 不保存正文 |
| `transport.routes`、`transport.schedule_periods`、`transport.schedule_items` | Ops Web | 当前线路和完整班次表由 Ops Web 直接维护；没有自动清理或通知回放 |
| 门户原始 source/file/source.json | 采集/来源数据面 | 按来源清单和业务引用决定；由来源 owner 人工核对清理 |
| normalized reader/source manifest | Campus Docs/Campus Web 数据面 | 当前及仍被清单引用的历史对象保留 |
| Docs/Notice chunk/embedding 内容寻址制品 | Campus RAG retrieval serving | 由显式引用或人工清单治理，不加宽泛 TTL |
| 当前索引及旧 Qdrant collection | Campus RAG serving | 当前 collection 保留；旧 collection 人工核对后删除 |
| logs/traces/evaluation records | 各观测/评测系统 | 各系统自己的 retention 合同 |

对象存储 lifecycle 只表达已确认的阶段性规则，不替代数据 owner 对 source、normalized、chunk 和
embedding 制品的存活判断。未有明确引用或删除清单时，本仓库不自动增加通用 TTL 或清理器。

## 连接预算

连接上限是部署容量合同，不能从“当前没有报错”推断出来。常驻 workload 和一次性 Job 必须把
连接池上限、最大副本数和最大 Job 重叠数一起纳入环境仓的容量计算。

当前源码可确认的单实例上限如下：

| 消费方 | 单实例上限 | 说明 |
| --- | ---: | --- |
| execution-control projection | 8 | `pgxpool` runtime pool |
| execution-control personal memory state | 4 | 与 projection 分开的 pool |
| Model Config runtime | 4 | 只供在线配置服务 |
| Ops Web runtime | 4 | internal-portal check 也复用该 pool 上限 |
| App API Node runtime | 4 | 部署环境的 Node pool；Cloudflare Worker 使用 Hyperdrive，不建立该 pool |
| campus-agent schema migrator | 1 | 统一 Job 的 PostgreSQL client |
| Ops Web bootstrap | 1 | transport 与 Dining bootstrap 各进程显式使用单连接 pool |
| notice-publisher | 1 | Job 进程显式使用单连接 pool |
| Campus RAG publisher | 1 | 使用单个 PostgreSQL client |

`ingestion-control` 已退役，也不计入当前预算。App API Worker 的 Hyperdrive 连接数由 Cloudflare
平台和环境仓配置拥有，源码仓不能给它假定一个本地 pool 上限。

每个环境必须使用以下不变量核对，而不是把某个单独的默认值当作安全结论：

```text
常驻 Pod 副本 × 各自 pool 上限
集群内最大重叠的 schema/bootstrap/publisher/check Job 连接
Cloudflare Hyperdrive 平台预算
CNPG、Temporal、Hindsight 及其他平台保留连接
安全余量
<= PostgreSQL max_connections
```

当前 CNPG 清单没有声明 `max_connections`、备份保留或平台侧 Hyperdrive 预算；因此仓库只能声明
上述计算方法和应用侧上限，不能声称当前环境已经满足该不变量。环境仓在调整副本、启用暂停的 Job
或改变数据库规格时，必须重新计算并记录结果。

## 访问规则

- 数据库级 `CONNECT` 不依赖 `PUBLIC` 默认授权（[campus_agent 共享库连接授权模型](../../.agents/notes/implemented/architecture/2026-09-16-campus-agent-connect-acl.md)）：
  `campus_agent` 库对 `PUBLIC` 仅保留 `TEMP`；显式 `CONNECT` 授权为 owner `campus_agent`
  与运行角色 `app_api`、`execution_control`、`model_config`、`ops_web`。新增连接该库的角色
  必须在环境实施时同步补授权，且库级权限调整前先以 `pg_stat_activity` 和本文角色表核对
  真实消费者。
- 协作者只读角色（如 `hindsight_ro`）的数据库级授权、凭证与生命周期由
  [协作者只读访问](../runbooks/collaborator-access.md) 拥有，不进入本文产品角色清单。
- 常驻运行时不使用 schema 管理或 migration 凭据；
- 每个运行时只获得完成其职责所需的表、列和操作权限；
- `campus-agent-schema` 为 `execution_control` 授予所属 schema `USAGE` 和表的
  `SELECT`、`INSERT`、`UPDATE`、`DELETE`。该角色不获得 schema `CREATE`、表 `TRUNCATE`、
  `REFERENCES`、`TRIGGER`，也不能访问 App API 所有的 `runtime.request_observability_fact`；
- execution-control 表所有者向 `ops_web` 授予 `agent_runs` 和 `agent_step_attempts` 当前运维
  投影使用的精确列读取。Ops Web bootstrap 不创建、扩大或收回 execution-control 表权限；
- `app_api` 仅可读取 `execution_control.agent_runs` 的 `request_id`、`status` 两列，供 App API 的
  Ops 会话摘要查询关联最新 dispatch，在分页前区分和筛选待处理、运行中；执行状态仍由
  execution-control 写入。chat dispatch 不记录执行阶段，逐请求 HTTP 查询不能承担该列表的 SQL
  筛选。授权由统一 migration 安装，其他执行列、事件及写权限保持关闭；消费者退役时由新 migration
  收回这两列授权。
- `execution_control.agent_campus_search_diagnostics` 保存 Ops 检查 RAG 所需的有界候选和阶段快照，
  `execution_control` 读写、`ops_web` 只读列级诊断字段，`app_api` 无权限。它与所属 run 级联删除；
  不因此向 Ops Web 开放 `agent_run_events` 或 `agent_step_results`；
- 在线模型配置只能通过 Model Config 管理接口修改，Ops Web 不直连其 schema；
- `execution_control` 对 `campus_docs_serving.current_index` 具有 `SELECT`、`INSERT`、`UPDATE`，
  但不具有 `DELETE`、`TRUNCATE`、`REFERENCES` 或 `TRIGGER`；统一 Campus RAG publisher 和在线
  Campus Search 复用该身份，前者负责激活当前绑定，后者只读取当前绑定；Docs/Notice builder 不访问该表；
- `model_config.model_configs` 可以为空或只配置一个 name；schema 安装不把业务配置完整性
  变成部署门禁。缺失 name 由其消费路径失败关闭。
- App API 读取 Dining 当前发布地图、菜单和公开评价；可创建或删除学生自己的评价并创建举报，
  可读取评价历史的清理标识、期限与操作者列并清理到期记录，不能读取历史正文、地图草稿或修改地图菜单；
- App API 只能读取 `notices` 的通知、资源 metadata、类型、组织和分类业务表，不能读取
  `drizzle.campus_agent_migrations` 或写入该 schema；
- App API 对 `transport.routes`、`transport.schedule_periods` 和 `transport.schedule_items` 只有读取权限；
  Ops Web 使用 `ops_web` 角色维护三张班车表；
- Ops Web 使用同一 `ops_web` 角色维护 Dining 地图、菜单、评价、举报和评价修改历史；
- Ops Web 使用 `ops_web` 角色读写 `internal_portal.credentials` 和
  `internal_portal.automation_tokens`；token 明文保留是为满足 Ops Web 的重复 reveal 合同，不作为通用
  Secret 管理能力；当前运行时不创建或使用旧 `ingestion_control` 角色；
- 不同逻辑所有者共用统一 migration ledger，但不通过双写复制同一事实，也不共享运行时写权限；
- 对象 bytes、无界原始来源、工作流历史和供应商 trace 不进入这些 schema。Campus Search 的有界候选
  正文是为 Ops RAG 诊断保留的快照，不作为来源系统副本。

角色、grant、schema 安装和应用查询必须共同变化。新增数据库列不会自动进入其他所有者的读取
权限或 API 响应。所属应用交付声明式 schema 与查询变化，统一 Job 交付安装 SQL 和授权；常驻
workload 只使用运行角色。
数据库平台只维护数据库 owner 和明确需要的无登录授权主体。

### Dining 用户投稿的权限扩展边界

投稿结构与 ACL 已通过统一 schema Job 安装，继续复用 `app_api` 和 `ops_web`，不新建 Dining
数据库、运行时角色或连接通道。领域声明式结构由 Dining 包维护；投稿和照片表、投稿编辑与举报表，
以及评价双目标 FK 均由追加迁移交付，Ops bootstrap 同步重放和验证这些权限。

App API 当前实现投稿创建、本人修改与软删除、公开及本人读取、照片关联和失败上传补偿。写入事务
锁定既有认证用户行，与账号注销准入共用锁；最终事务重新检查身份、窗口、版本、每日配额和幂等。
投稿编辑历史只开放写入及清理所需权限，不向学生读取路径开放历史正文。App API 仍不能读取地图
草稿、评价历史正文，或修改地图和正式菜单。数据库授权不能代替 HTTP 本人所有权和 Ops 鉴权。

投稿评价、举报和 Ops 治理路由已接入两目标关系；Ops 读取治理所需的操作者列，
投稿与地图发布通过事务锁协调窗口引用。Dining 定时清理和账号注销共用领域清理入口；
`app_api` 可删除已到期评价及历史，更新举报详情与身份列，但不能写举报结论或读取评价历史正文。
`reviews.updated_by` 允许在注销去身份时置空。未绑定照片临时保存 `upload_owner_id`，
与注销受理共用用户行锁；绑定时清空，注销时转交请求 ID，避免遗漏在途上传。
图片字节保存在私有对象存储，PostgreSQL 只保存引用和生命周期字段。完整保留
规则由 [Dining PRD](../product/dining.md)维护；授权由空库、历史升级及真实运行角色测试验证。

## 可执行来源

- 当前 DDL、授权和具名 SQL migration：`jobs/campus-agent-schema/`
- App API 声明式 schema：`apps/app-api/src/db/schema/`
- Ops Web 声明式 schema：`packages/domains/dining/src/schema.ts`、
  `apps/ops-web/ops/db/internal-portal-schema.ts`
- 本地业务 seed：`apps/app-api/ops/db/`、`jobs/notice-publisher/src/seed-local.ts`、
  `apps/ops-web/ops/db/`
- `apps/app-api/src/db/schema/` 只描述 App API 所属表，不再提供可执行 migration runner；其他应用自有 schema runner、旧 migration
  目录和 legacy integration profile 已退役。当前新建或重建数据库只通过 `jobs/campus-agent-schema/` 安装。

## 相关文档

- [App API 数据结构](./app-api/README.md)
- [持久执行数据](./durable-runtime.md)
- [食堂](../product/dining.md)
- [采集数据面](../architecture/system/data-plane.md)
- [Kubernetes 运行时](../architecture/system/k8s-runtime.md)
- [检索服务](../architecture/system/retrieval-serving.md)
- [Campus Docs 与 Notices 维护及统一 RAG 发布](../runbooks/campus-docs.md)
- [PostgreSQL](../../.agents/notes/implemented/architecture/2026-07-16-postgres.md)
