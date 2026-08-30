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

下表是当前实现中的权限主体清单，不是“每个运行时必须一个角色”的通用规则。角色按数据所有权、
信任边界和生命周期决定；同一边界可以共享角色，只有存在独立授权或运维边界时才拆分。调整现有
角色、schema 或 Secret 属于独立的数据库/环境实施任务，本文件的治理规则不自动改变当前部署。

| 角色 | 运行所有者 | 权限边界 |
| --- | --- | --- |
| `campus_agent` | 数据库 bootstrap 与显式 schema/publisher Job | schema 安装、授权和一次性规范化发布，不用于常驻运行时 |
| `app_api` | `apps/app-api` | 产品数据读写和获准运行摘要读取 |
| `execution_control` | `apps/execution-control` | 执行投影和个人记忆状态读写 |
| `model_config` | `apps/model-config` | 当前具名模型配置与加密凭据读写 |
| `notice_publisher` | 本地 `jobs/notice-publisher` | 本地规范化通知写入；部署环境不创建该角色 |
| `ops_web` | `apps/ops-web` | 获准运行投影的列级只读访问、Dining 内容维护和内部门户凭据及 automation token 读写 |

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
| `execution_control.agent_*`、`execution_control.conversation_run_locks`、`execution_control.personal_memory_*`、`execution_control.owner_deletion_fences` | execution-control | execution-control、获准 Ops Web 投影 |
| `model_config.model_configs` | Model Config | Model Config；其他消费者只通过内部 HTTP 合同 |
| `campus_docs_serving.current_index` | Campus Docs serving（当前 publisher 复用 `execution_control` 技术身份写入） | Campus Docs publisher；供后续在线知识能力使用 |
| `notices.*` | notice-publisher（部署 Job 复用 `campus_agent`） | App API 只读业务表 |
| `dining.*` | Ops Web | Ops Web、App API 公开读取 |
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

Campus Web 静态文档发布只使用对象存储和构建产物。Campus Docs serving 逻辑上拥有
`campus_docs_serving.current_index` 单行绑定；当前 publisher 继续复用 `execution_control` 数据库身份
写入。当前在线 execution-control 不读取该表；发布任务不创建独立数据库角色、连接字符串或 Secret。
旧 `docs.*` schema 由 App API migration 删除，历史 migration 不构成当前所有权。
通知 schema 与显式发布 Job 同样复用既有 `campus_agent` owner Secret，不创建线上
`notice_publisher` 登录或密码。`notice_publisher` 只保留为本地 worktree 的开发角色；通知 migration
在该角色存在时授予本地发布权限，在部署环境缺失该角色时直接使用 owner。

## 迁移合同

新建或重建数据库只有一个可执行 DDL 入口：`jobs/campus-agent-schema`。它以 `campus_agent` 连接，
使用 PostgreSQL advisory lock，并把全部产品 schema 记录在
`drizzle.campus_agent_migrations`。逻辑数据所有权和运行角色权限仍按上节划分；共享 migration ledger
不表示应用之间共享写权限。

- `migrations/0000_campus_agent_baseline.sql` 是 schema-only 的最终结构基线，不包含校园群组、测试
  用户、通知分类、Dining 草稿或其他业务数据；这些内容由独立 seed 写入；
- 已应用的统一 migration 不得修改或重排。结构变化更新所属声明式 schema，并在
  `jobs/campus-agent-schema/migrations/` 追加下一条 SQL 与 journal 记录；不再新增领域 ledger；
- migrator 只接受标准 `PG*` 环境变量，运行用户必须是 `campus_agent`。常驻 Store、Better Auth、
  publisher 和业务 bootstrap 不执行 DDL；
- 新入口不是旧数据库的原位升级器。发现 `drizzle.app_api_migrations`、
  `drizzle.ops_web_dining_migrations`、`public.execution_control_migrations`、
  `model_config.schema_migrations`、`notices.schema_migrations` 或 `execution_config` 时明确失败；
- 旧 migration 文件和 runner 暂作为现有部署数据库的不可变历史保留，标准本地 bootstrap 不再调用。
  源码 migration 由既有 GitOps schema Job 按环境 revision 应用；源码仓不直接修改在线数据库；
- `0002_remove_runtime_personal_memory_compat_views` 只删除无消费者的 `runtime.*` 个人记忆兼容 View，
  不删除 `execution_control.personal_memory_*` 表或其数据；
- 在线切换必须在独立任务中先停写和备份，再验证数据迁入统一结构，最后切换 GitOps。没有完成这套
  数据迁移前，不得把统一 Job 指向带旧 ledger 的数据库；
- 修改统一 migration 后，至少验证空库首次执行、重复执行、owner 与关键 ACL、旧对象拒绝、退役 View
  消失且底层表仍在，以及两个并发 migrator 的串行结果。验证可以直接使用隔离的本地 PostgreSQL，
  不要求重型 Testcontainers。

`campus_docs_serving` 与其他 schema 共用统一 ledger；publisher 只写业务记录，不执行 DDL。

## 数据生命周期

| 数据 | 逻辑 owner | 生命周期与清理责任 |
| --- | --- | --- |
| 用户、会话、原始执行输入 | App API | 账号生命周期；由 App API 删除任务清理 |
| execution run/event/step/attempt/result projection | execution-control | 账号删除完成前保留，删除时 cascade 清理 |
| `owner_deletion_fences(state=deleted)` | execution-control | 保留最小 tombstone，阻止 owner 复活；不含用户内容 |
| Temporal history | Temporal/platform | 按平台 retention；不由 PostgreSQL 删除任务即时清理 |
| Hindsight personal memory | Hindsight；execution-control 推进删除命令 | 账号清除合同；execution-control 不保存正文 |
| 门户原始 source/file/source.json | 采集/来源数据面 | 按来源清单和业务引用决定；由来源 owner 人工核对清理 |
| normalized reader/source manifest | Campus Docs/Campus Web 数据面 | 当前及仍被清单引用的历史对象保留 |
| chunk/embedding 内容寻址制品 | Campus Docs retrieval serving | 由显式引用或人工清单治理，不加宽泛 TTL |
| 当前索引及旧 Qdrant collection | Campus Docs serving | 当前 collection 保留；旧 collection 人工核对后删除 |
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
| Ops Web bootstrap/dining | 1 | bootstrap 进程显式使用单连接 pool |
| notice-publisher | 1 | Job 进程显式使用单连接 pool |
| Campus Docs publisher | 1 | 使用单个 PostgreSQL client |

`providerconfig.Store` 只保留为历史迁移和测试辅助，不是当前常驻运行时消费者，不计入常驻预算。
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

- 常驻运行时不使用 schema 管理或 migration 凭据；
- 每个运行时只获得完成其职责所需的表、列和操作权限；
- `campus-agent-schema` 为 `execution_control` 授予所属 schema `USAGE` 和表的
  `SELECT`、`INSERT`、`UPDATE`、`DELETE`。该角色不获得 schema `CREATE`、表 `TRUNCATE`、
  `REFERENCES`、`TRIGGER`，也不能访问 App API 所有的 `runtime.request_observability_fact`；
- execution-control 表所有者只向 `ops_web` 授予 `agent_runs` 和 `agent_step_attempts` 当前运维
  投影使用的精确列读取。Ops Web bootstrap 不创建、扩大或收回 execution-control 表权限；
- 在线模型配置只能通过 Model Config 管理接口修改，Ops Web 不直连其 schema；
- `execution_control` 对 `campus_docs_serving.current_index` 具有 `SELECT`、`INSERT`、`UPDATE`，
  但不具有 `DELETE`、`TRUNCATE`、`REFERENCES` 或 `TRIGGER`；发布任务复用该身份，当前在线
  execution-control 不消费该表；
- `model_config.model_configs` 可以为空或只配置一个 name；schema 安装不把业务配置完整性
  变成部署门禁。缺失 name 由其消费路径失败关闭。
- App API 读取 Dining 当前发布地图、菜单和公开评价；可创建或删除学生自己的评价并创建举报，
  但不能读取地图草稿和评价修改历史，也不能修改地图或菜单；
- App API 只能读取 `notices` 的通知、资源 metadata、类型、组织和分类业务表，不能读取
  `drizzle.campus_agent_migrations` 或写入该 schema；
- Ops Web 使用同一 `ops_web` 角色维护 Dining 地图、菜单、评价、举报和评价修改历史；
- Ops Web 使用 `ops_web` 角色读写 `internal_portal.credentials` 和
  `internal_portal.automation_tokens`；token 明文保留是为满足 Ops Web 的重复 reveal 合同，不作为通用
  Secret 管理能力。历史环境中的 `ingestion_control.internal_portal_credentials` 由 Ops Web 的一次性
  handoff migration 原位迁入并清理旧 schema；当前运行时不再创建或使用旧角色；
- 不同逻辑所有者共用 DDL journal，但不通过双写复制同一事实，也不共享运行时写权限；
- 对象 bytes、原始来源、工作流历史和供应商 trace 不进入这些 schema。

角色、grant、schema 安装和应用查询必须共同变化。新增数据库列不会自动进入其他所有者的读取
权限或 API 响应。所属应用交付声明式 schema 与查询变化，统一 Job 交付安装 SQL 和授权；常驻
workload 只使用运行角色。
数据库平台只维护数据库 owner 和明确需要的无登录授权主体。

## 可执行来源

- 当前 DDL、授权和 migration journal：`jobs/campus-agent-schema/`
- App API 声明式 schema：`apps/app-api/src/db/schema/`
- Ops Web 声明式 schema：`packages/domains/dining/src/schema.ts`、
  `apps/ops-web/ops/db/internal-portal-schema.ts`
- 本地业务 seed：`apps/app-api/ops/db/`、`jobs/notice-publisher/src/seed-local.ts`、
  `apps/ops-web/ops/db/`
- `apps/app-api/drizzle/`、`apps/ops-web/drizzle/`、`apps/execution-control/internal/schemamigrations/`、
  `apps/model-config/internal/modelconfig/` 和 `jobs/notice-publisher/migrations/` 暂保留为现有部署数据库
  的不可变历史，不是新建本地数据库的执行入口。

## 相关文档

- `app-api/README.md`
- `durable-runtime.md`
- `../product/dining.md`
- `../architecture/system/data-plane.md`
- `../architecture/system/k8s-runtime.md`
- `../decisions/adr-0073-postgres.md`
