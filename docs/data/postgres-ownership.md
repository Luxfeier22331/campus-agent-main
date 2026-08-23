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
表由 `apps/app-api/src/db/schema/auth.ts` 描述，全部 App API 自有表由 `managed.ts` 汇总，并使用
`drizzle.app_api_migrations` 这一条 ledger 迁移；Better Auth 运行时不执行 DDL，也不维护第二条
migration 记录。

Campus Web 静态文档发布只使用对象存储和构建产物。Campus Docs serving 逻辑上拥有
`campus_docs_serving.current_index` 单行绑定；当前 publisher 继续复用 `execution_control` 数据库身份
写入。当前在线 execution-control 不读取该表；发布任务不创建独立数据库角色、连接字符串或 Secret。
旧 `docs.*` schema 由 App API migration 删除，历史 migration 不构成当前所有权。
通知 schema 与显式发布 Job 同样复用既有 `campus_agent` owner Secret，不创建线上
`notice_publisher` 登录或密码。`notice_publisher` 只保留为本地 worktree 的开发角色；通知 migration
在该角色存在时继续授予本地发布权限，在部署环境缺失该角色时直接使用 owner。

## 迁移合同

每个 schema 所有者只维护一条追加式 migration ledger：

| 所有者 | 可执行 schema | Migration ledger |
| --- | --- | --- |
| App API | `apps/app-api/src/db/schema/managed.ts` 与 `apps/app-api/drizzle/` | `drizzle.app_api_migrations` |
| execution-control | `apps/execution-control/internal/schemamigrations/` | `public.execution_control_migrations` |
| Model Config | `apps/model-config/internal/modelconfig/migration.go`（schema Job 以 `campus_agent` 执行） | `model_config.schema_migrations` |
| 通知 | `jobs/notice-publisher/migrations/` | `notices.schema_migrations` |
| Ops Web | `packages/domains/dining/src/schema.ts`、`apps/ops-web/ops/db/internal-portal-schema.ts` 与 `apps/ops-web/drizzle/` | `drizzle.ops_web_dining_migrations`（保留历史名称） |

- 已应用 migration 不得修改、重排或重新生成；结构变化新增下一条 migration。Drizzle 的 SQL、
  journal 和 snapshot 必须成套提交，Goose 的 SQL 与 Go migration 版本同样只追加；
- baseline 只描述工具接管前的已知结构，不是当前 schema。首次接管只能接受空库或经过测试的精确
  前置结构；没有 ledger 的未知部分状态必须失败，不能用 `IF NOT EXISTS` 拼成表面成功；
- 自定义 migration 只用于普通 SQL 不能表达的数据转换。历史 Provider 密文先由冻结的 Goose
  migration 规范化，再由 Model Config schema 命令完成跨所有者切换；运行时 Store、Better Auth
  和业务 bootstrap 不执行 DDL；
- grants 在 migration 成功后由 schema Job 独立应用，Dining 初始草稿在 schema 和 grants 完成后
  独立写入。重跑 grants 或 bootstrap 不得代替 migration；
- `IF EXISTS`、`IF NOT EXISTS` 只用于 migration 已明确支持且由集成测试覆盖的前置状态，不作为
  未知结构、缺失对象或失败 migration 的 fallback；
- Model Config schema Job 必须拒绝 `model_config` schema、表、列、constraint、index、owner、ledger
  或 grant 的未知/漂移状态；`campus_agent` 是 DDL owner，`model_config` 只作为常驻 runtime role，
  不新增或拆分数据库角色；
- 修改 migration 时必须运行所属 PostgreSQL Testcontainers 套件，至少覆盖空库、受支持历史升级、
  未知部分状态、重复执行及运行角色权限；Drizzle 所有者还要覆盖已应用 hash 校验。

`campus_docs_serving` 的 DDL 和授权属于 execution-control 的 migration ledger；publisher 只写业务
记录，不执行 DDL 或维护第二条 migration ledger。

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
| execution-control schema migrator | 1 | `database/sql` migration connection |
| Model Config schema installer | 1 | `database/sql` migration connection |
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
- `run-projection-schema` 在执行投影和个人记忆状态表全部安装后，将运行角色的
  `execution_control` 权限收敛为 schema `USAGE`，以及所属表的 `SELECT`、`INSERT`、`UPDATE`、
  `DELETE`。该角色不获得 schema `CREATE`、表 `TRUNCATE`、`REFERENCES`、`TRIGGER`，也不能访问
  App API 所有的 `runtime.request_observability_fact`；
- execution-control 表所有者只向 `ops_web` 授予 `agent_runs` 和 `agent_step_attempts` 当前运维
  投影使用的精确列读取。Ops Web migration 不创建、扩大或收回 execution-control 表权限；
- schema Job 必须校验上述固定角色的有效权限。常驻 execution-control 的运行投影和个人记忆
  状态健康检查必须实际读取所属表，不能用 PostgreSQL catalog 可见性代替运行角色的数据访问能力；
- 在线模型配置只能通过 Model Config 管理接口修改，Ops Web 不直连其 schema；
- `execution_control` 对 `campus_docs_serving.current_index` 具有 `SELECT`、`INSERT`、`UPDATE`，
  但不具有 `DELETE`、`TRUNCATE`、`REFERENCES` 或 `TRIGGER`；发布任务复用该身份，当前在线
  execution-control 不消费该表；
- `run-projection-schema` 仍顺序执行全部历史 Goose migration，并只把旧 Provider Config 密钥作为
  历史 v8 输入。随后 `model-config-schema` 在同一事务中读取
  `execution_control.model_settings`，使用旧密钥解密、校验目标冲突、以 Model Config 密钥重加密，
  写入 `model_config.model_configs` 并删除旧表及兼容 view；不得双写或保留运行时 fallback。
- `model_config.model_configs` 可以为空或只配置一个 name；schema 安装不把业务配置完整性
  变成部署门禁。缺失 name 由其消费路径失败关闭。
- Goose v4 将 execution-control 的 12 张运行表和 `model_settings` 原位移动到
  `execution_control`。`runtime` 与 `execution_config` 下的同名对象暂为不可写兼容视图，只支持
  切换期间的旧读取；旧 writer 不获得 DML。活跃环境完成停写迁移、同 revision 部署和读取验证后，
  才能由后续 migration 删除这些视图及空的 `execution_config` schema；源码合并本身不证明环境已
  完成该清理。
- Goose v5 在已移动的 `execution_control.model_settings` 上暂时新增 `embedding_space_id`，并创建
  `campus_docs_serving.current_index`；Goose v6 删除模型设置中的向量字段以及当前索引中的
  `embedding_model`、`embedding_provider`；Goose v7 规范现有 Embedding 设置并要求重新验证；Goose
  v9 删除当前索引中剩余的查询定义字段，只保留 `singleton` 和 `collection`。已应用 v3 的数据库通过
  v4 至 v9 顺序升级，不会重跑或改写历史 migration。
- App API 读取 Dining 当前发布地图、菜单和公开评价；可创建或删除学生自己的评价并创建举报，
  但不能读取地图草稿和评价修改历史，也不能修改地图或菜单；
- App API 只能读取 `notices` 的通知、资源 metadata、类型、组织和分类业务表，不能读取
  `notices.schema_migrations` 或写入该 schema；
- Ops Web 使用同一 `ops_web` 角色维护 Dining 地图、菜单、评价、举报和评价修改历史；
- Ops Web 使用 `ops_web` 角色读写 `internal_portal.credentials` 和
  `internal_portal.automation_tokens`；token 明文保留是为满足 Ops Web 的重复 reveal 合同，不作为通用
  Secret 管理能力。历史环境中的 `ingestion_control.internal_portal_credentials` 由 Ops Web 的一次性
  handoff migration 原位迁入并清理旧 schema；当前运行时不再创建或使用旧角色；
- 不同所有者不共享 migration journal，也不通过双写复制同一事实；
- 对象 bytes、原始来源、工作流历史和供应商 trace 不进入这些 schema。

角色、grant、schema 安装和应用查询必须共同变化。新增数据库列不会自动进入其他所有者的读取
权限或 API 响应。拥有 schema 的应用同时交付安装命令和授权；常驻 workload 只使用运行角色。
数据库平台只维护数据库 owner 和明确需要的无登录授权主体。

## 可执行来源

- App API schema：`apps/app-api/src/db/schema/`、`apps/app-api/ops/db/`、`apps/app-api/drizzle/`
- 通知 schema 与授权：`jobs/notice-publisher/migrations/`
- 执行投影：`apps/execution-control/internal/schemamigrations/`
- 模型配置：`apps/model-config/internal/modelconfig/`
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
