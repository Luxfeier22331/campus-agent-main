---
doc_type: runbook
owner_boundary: ingestion-data-plane
status: active
---

# 采集运行

## 范围

本文说明内部门户通知与文件发布采集、分类交接和通知发布。集群环境由 `notice-pipeline-worker` 在
Temporal 上按采集、分类、发布、RAG 刷新的固定顺序自动串联；系统没有通用采集任务控制面、来源 callback
或独立 run ledger。通知分类、发布等既有 Job 保留为单阶段入口，供 Ops 一次性任务和手动恢复使用。

## 前置条件

- 统一 schema bootstrap 使用数据库 owner 连接；Ops Web 凭据表位于
  `internal_portal.credentials`；
- 通知采集、分类和发布共享 `notices.*`；本地和集群都由 `campus-agent-schema` 安装；
- source 与 derived bucket 使用各自对象存储凭据；
- Ops Web 与 internal-portal-collection 来自同一 source revision；
- 使用本地命令时，已通过 `pnpm --dir jobs/internal-portal-collection auth:pull` 从 Ops Web 解析当前有效 TGC；使用 Job 入口时，
  已提供 `OPS_WEB_INTERNAL_URL` 和既有内部 token。

## 数据库与本地进程

```bash
pnpm dev:init -- --target core
pnpm dev:init -- --target internal-portal-collection
pnpm --filter ops-web dev:api
```

数据库 TLS 与运行变量见 Ops Web 的环境合同。当前本地与 Kubernetes 拓扑使用
`drizzle.campus_agent_migrations`。通知相关 target 声明所需 schema、分类目录与环境投影，
`dev:init` 通过 readiness 复用已完成的 bootstrap，不重复执行 DDL，也不导入通知业务数据。
通知分类由当前 Model Config 配置和分类器 Job 负责，不由 agent-control 持有。

## 文件发布

本地按门户库存分页采集文件发布：

```bash
pnpm --dir jobs/internal-portal-collection collect -- --mode file-sync
```

命令按顺序逐条处理。已有合法 `source.json` 时复用；普通单项失败继续并汇总，认证失败立即终止。结果只在
source bucket 保存 `file` 与 `source.json`，不解析 PDF。集群通过通知工作流的 `file-sync` mode
调用同一实现，不继续通知分类和索引阶段。

## 本地通知流程

通知流程由独立、显式的步骤组成：本地采集不会自动分类或发布，publisher 也不会触发后续领域处理；
集群的自动串联见下文 Kubernetes 段。

### 初始化与认证

```bash
pnpm dev:init -- --target internal-portal-collection
pnpm --dir jobs/internal-portal-collection auth:pull
pnpm --dir jobs/internal-portal-collection auth:check
```

`internal-portal-collection` target 会准备当前 worktree 的 schema、通知分类 seed、Ops Web 和采集器环境；
采集器环境包含 source bucket 与通知数据库连接。`notice-classifier` target 同样准备 schema、通知分类 seed，
并生成 Model Config URL 与分类器环境。两者不维护 package-level 初始化入口，也不重复执行 DDL。
`pnpm --dir jobs/internal-portal-collection auth:pull` 按 [内部门户认证](../access/portal-auth.md) 使用当前 Kubernetes context 和 namespace 调用 Ops Web
凭据解析接口，并原子更新受管理的适配器 `.env.local`；认证检查必须成功后才能请求门户。
本地通知命令随后直接使用拉取到的 TGC，不需要后台编排器。

### 小范围采集

通知维护状态是日期半开区间 `M=[start,end)`：`start` 包含，`end` 排除：

- `notice-sync` 发现门户最新边界 `P`，从 `max(start,end 前一天)` 扫描到 `max(end,P)`，
  补齐最后一个日期稍后发布的通知，成功后只向前推进上界；
- `notice-backfill --start-date S` 采集 `[S,start)`，成功后把状态扩展到 `[S,end)`。
- `notice-rescan --from F --to T` 补查已有维护范围并刷新已有通知详情，不改变维护边界。

因旧通知置顶导致上界停滞时，部署修复后运行现有 `notice-pipeline`，由 sync 从已有上界继续补采，
再完成分类、发布和索引刷新；不要手改 `_state.json` 或用仅覆盖已有区间的 rescan 代替向后补齐。
按缺失通知 ID 核对数据库、Campus 和当前索引，流水线成功或 `upToDate=true` 不能代替数据恢复确认。

首次初始化必须先从约定起点 `2025-12-01` 回填，再运行 sync。根据目标数据范围明确日期边界，先完成
小范围验证，再扩大同一来源范围：

```bash
NOTICE_START_DATE=2025-12-01
pnpm --dir jobs/internal-portal-collection collect -- --mode notice-backfill --start-date "$NOTICE_START_DATE"
pnpm --dir jobs/internal-portal-collection collect -- --mode notice-sync
```

回填起点必须是本次明确选择的日期；当前首次初始化约定为 `2025-12-01`。没有完整维护区间时，sync
会拒绝运行。适配器把内部排他上界转换为门户闭区间 `end_date` 的前一天，并用详情发布时间再次执行
`[start,end)` 校验。sync、backfill 与 rescan 通过 PostgreSQL advisory lock 串行执行，不能并发运行。后续
sync/backfill 会按顺序下载正文引用的图片和附件。成功后检查 source bucket 包含
`internal_portal/meta.json`、通知对象、已成功采集的资源对象和 `_state.json`，确认当前 v4 状态中的
`covered_from/covered_until` 区间符合本次 Job，且对应通知已登记到
`notices.notices`。来源对象必须通过版本化 schema，内部通知与外链字段必须成对合法；source、metadata、库存登记或
非永久缺失的资源传输失败时状态不能推进。通知附件明确返回 HTTP 404 时保留 source metadata、跳过附件资源对象，
继续登记通知并允许状态推进；发布时该附件不进入 `notice_assets`。图片 404、附件的其他 HTTP 错误、超时、流中断
和对象存储失败仍然阻止推进。单条通知的详情缺失 `notice_info`、source 构造失败（如 `notice_title` 缺失）、
详情接口非认证性报错、列表项 `notice_type` 非法或库存登记数据冲突时，该通知计入失败（stderr 中的
`detail`/`source`/`item`/`inventory` operation），其余通知继续处理，但状态不能推进直到失败清除；
认证失败（TGC 过期等）与列表项 `notice_id` 非法（通知身份不可识别）仍立即终止整批。
门户明确返回通知删除或失效消息时，按不可用通知处理并记录 `unavailable_at`，不作为普通详情失败
阻止水位推进；v4 状态保留有界不可用 ID。恢复可读后清除不可用状态，详见[通知数据](../../data/notices.md)。
输入合同分层：分页完整性（`total`、`totalCounts`、固定 `pageSize` 与 `Math.ceil` 关系）与
notice type 映射（`notice_type_id`/`notice_type_name`、重复项、非空）是被引用的阻断性检查——空 type
映射会让全量通知被过滤、分页不一致意味着漏采，二者必须阻止水位推进；organization 映射当前不被采集
正确性引用（通知行的组织字段直接来自列表/详情，映射仅作展示查询），其缺字段、重复或冲突项只记
`noticeMetadata` 诊断日志并跳过，不阻断批次。附件
请求按门户附件 ID 和通知 ID 构造，单个图片或附件上限为 100 MiB；外链通知不会触发外部正文或图片
抓取。仓库不提供独立的资源维护或状态查看命令。通知数据结构见 [通知数据](../../data/notices.md)。

### 本地分类交接

分类脚本只读本地来源并把结果写到标准输出：

```bash
pnpm --dir scripts notice:classify --concurrency 2 --notice-id "$NOTICE_ID"
```

该命令是 JSONL stdout 交接和离线模型比较入口，由调用进程显式提供模型连接，生成一次性的
`notice_id/category` JSONL；它不读取或修改 agent-control 的在线模型设置。整批成功后把结果保存到
未跟踪路径，并设置：

```bash
NOTICE_CLASSIFICATIONS=/absolute/path/to/classifications.jsonl
```

每个通知只能出现一次，并具有一个共享合同允许的分类；标题不足以判断唯一分类时才使用
`unclassified`。单条通知对临时 provider 和非法结构化输出最多尝试三次，耗尽预算后整批失败。
分类文件不保存理由、置信度、模型名称或原始响应，也不写入对象存储或 PostgreSQL。
具体脚本输入和平衡模型评估见 [内部门户通知分类](../../../scripts/notices/README.md)。

需要在本地验证在线 Job 时，使用同一数据库实现：

```bash
kubectl port-forward svc/model-config 18003:8000

pnpm --dir jobs/notice-classifier classify:local \
  --model-config-url http://127.0.0.1:18003 \
  --notice-id "$NOTICE_ID" \
  --concurrency 2
```

该入口从当前 worktree 的通知数据库读取 ID 与标题，并写回 `category`。默认运行只分类
`category IS NULL` 的通知；`--notice-id` 明确覆盖指定通知的当前分类。它不读取独立模型凭据，也不把
API key 写入本地文件。

### 在线分类 Job

集群常规分类由通知流水线执行；单独使用 `notice-classifier` Job 前须确认目标环境已显式部署该暂停模板。
当前 ingestion base 不安装它，不能仅因源码存在就运行下述命令。分类器从数据库读取待分类通知；传入 `--notice-id` 时
只处理指定通知并强制重分类。Job 只向模型发送
原始标题，不消费正文、门户栏目或清洗结果：

```bash
kubectl create job \
  --from=cronjob/notice-classifier \
  notice-classifier-$(date +%Y%m%d%H%M%S)
```

在线模板使用 `--concurrency 8`，分类器 PostgreSQL 连接池上限与该并发一致；本地 CLI 默认并发为 2，
可按机器资源显式调整。失败以非零状态结束。默认批量更新不会覆盖分类期间发生的人工修改；
不会自动继续下一阶段。Job 启动分类阶段后从 `model-config:8000` 一次读取
`notice_classification` 完整配置，模型名和 provider 由 Ops Web 配置，不在镜像或 Kubernetes Secret
中固定。

### 通知 schema

`pnpm dev:init -- --target notice-publisher` 准备本地 `notice_publisher` 运行角色，并通过
`campus-agent-schema` 使用数据库 owner 安装 `notices.*`。该 target 可安全重跑：

```bash
pnpm dev:init -- --target notice-publisher
```

新采集通知默认未分类、未发布；线上由 `data-postgres` Application 中的 `campus-agent-schema` Job
使用既有 `campus_agent` owner Secret 安装统一 schema。

### 单条与批量发布

默认入口读取数据库中的待发布通知。先发布一个通知：

```bash
pnpm --filter notice-publisher run publish --notice-id "$NOTICE_ID"
```

核对正文、外链、图片和附件后，省略 `--notice-id` 发布已分类且未发布、或来源快照已变化的通知：

```bash
pnpm --filter notice-publisher run publish
```

已发布通知需要重新按当前清洗规则物化时，使用独立的 `republish` 命令；该命令保持
`is_published=true` 和分类不变：

```bash
pnpm --filter notice-publisher run republish --notice-id "$NOTICE_ID"
pnpm --filter notice-publisher run republish
```

离线模型比较产生的 JSONL 不进入发布链路。publisher 在数据库事务前完成来源读取、正文清洗和资源
摘要计算；图片立即写入 derived 内容寻址对象，附件只读取校验并留在 source bucket。发布与重新发布都
按通知独立 BEGIN/COMMIT：单条来源缺失、合同无效或资源投影冲突记入
`notices.processing_failures`（stage `publication`）后跳过，同批其余通知照常提交，摘要标记
`outcome: partial` 与 `failed` 数量；数据库或对象存储等基础设施错误仍以非零状态停止当前批次。
数据库不留部分通知，已验证的内容寻址图片可在重跑时复用，成功提交在同一事务中清除该通知的失败
记录。相同输入必须幂等。

重新发布原子更新当前来源的 metadata、正文与资源，并记录已发布来源引用；它不构建 chunk、embedding 或检索 collection。
正文变化在下一次 `notice-pipeline` 完整刷新（prepare/embed/activate）时进入 AI 检索，收敛窗口与
失败语义见[通知索引](./notice-indexing.md#与-republish-的一致性)。自动 republish 批次不排除已有
publication 失败记录的通知：republish 本身就是重试入口，幂等写入保证重复尝试无副作用。

### 产品验收

发布后至少确认：

- 通知与校园动态视图的数量、分页，以及关键词、分类、来源、门户栏目、发布部门和日期筛选；
- 站内正文通过清洗合同，标题不重复，图片按序号返回；
- 外链条目直接打开已校验来源，不进入站内详情；
- 附件显示 metadata 和门户原生链接，App API 不代理附件字节；
- 桌面与移动端没有正文、标签、日期或长附件名重叠；
- 未登录、空结果、无效参数、404 和依赖失败保留各自状态。

先完成一个站内通知、一个外链通知和一个含资源通知的浏览器验收，再扩大数据范围。本地对象和
PostgreSQL 结果不表示集群环境已经采集、发布或部署。

### 本地重新验证

通知数据库是采集库存和分类的当前事实，不从 source bucket 隐式重建。未发布通知可以直接重新运行
publisher；已发布内容与新清洗结果冲突时，由引入清洗合同变化的任务提供明确的数据迁移。需要验证一套
全新的端到端结果时，创建新的本地实例并依次执行通知 schema 初始化、采集、分类和发布，不在现有实例
中清空 `notices.notices` 或 `notices.notice_assets`。

上述本地 CLI 不自动串联阶段；集群的定时分类、发布和刷新由下述通知流水线执行。本地验证结果不表示集群
已经更新。App API 与 Campus Web 的读取路径也不表示任一环境已经完成写入或部署。

## Kubernetes

`infra/k8s/ops-web/base` 提供 Ops Web API、数据库授权 Job 和 `ops-web-internal-portal-check` CronJob；
`infra/k8s/ingestion-runtime/base/runtime` 当前仅渲染独立 OCR 任务及其网络策略；目录中的旧采集、分类、
发布与通知制品 CronJob YAML 保留为显式单阶段模板，不在该 base 的 Kustomization 中启用。

### 自动化与调度所有权

定时采集、分类、发布和索引刷新由 Temporal Schedule `notice-pipeline` 编排，不再由任何 CronJob 承担。
该 Schedule 由 `notice-pipeline-worker` 的 init 容器在部署时创建，默认暂停、周期 15 分钟、重叠 SKIP、
补调度时限 5 分钟；刷新与版本目录合同见[Campus Docs](./campus-docs.md)。运营在 Ops `/tasks` 任务页统一
启停和调整 15/30/60 分钟周期，通知维护页不再修改任何调度设置。

启用顺序：先完成一次遗漏补查（回填或 rescan）和一次成功的 `/tasks` 手动运行，确认流水线产物与发布
结果，再开启 Schedule。手动运行使用固定执行 ID `notice-pipeline-workflow`，与正在进行的流水线或回滚
重叠时返回 409，单次执行上限 4 小时；定时触发发现已在运行时跳过该轮。

通知维护页的 `/api/ops/notices/jobs` 将八种固定操作映射到 Temporal Workflow；部署环境不再读取
通知 CronJob 模板。完整流水线从 `/tasks` 运行，单项维护操作及其历史从通知维护页查看。
采集 sync、backfill、rescan 会继续执行分类、发布和索引刷新；单条分类、发布、重新发布只执行对应阶段。
文件同步通过 `file-sync` mode 执行，共用固定 Workflow ID。操作参数只属于本次运行，不写入长期配置。

手动恢复优先使用 Ops 任务页或通知维护页，并从 Temporal history 查看阶段结果和 heartbeat。源码保留的
暂停 CronJob 清单不是集群中模板存在的保证；不得从已删除的 `notice-sync`、`notice-backfill`、
`file-sync` 或 `notice-publisher` 创建 Job。具体接口见[通知维护合同](../../contracts/ops-web/notices.md)。

Worker 复用既有 Ops Web 凭据入口、数据库 owner Secret、PostgreSQL CA、Model Config 和 source/derived
对象存储配置。运行前确认到 Ops Web、PostgreSQL、对象存储、门户出口代理、模型服务与 Qdrant 的对应网络
方向；门户请求经代理出站，见[内部门户认证](../access/portal-auth.md#集群门户出口)。统一 `campus-agent-schema` Job 仍负责数据库结构与角色，不由通知 Workflow 执行迁移。

## 排查

流水线失败先在 Ops `/tasks` 查看 `notice-pipeline` 的最近执行、当前问题数量与索引状态，再进入 Temporal
执行历史定位失败阶段。文件发布先检查分页响应、逐项错误摘要、门户响应及两个固定 source 对象。通知先查看工作流返回的
`processedRange`、`maintenanceRange`、`progress`、原始应用错误、`controllerError`、通知对象和
`_state.json`，不要手工推进边界来伪装成功。`processedRange` 只说明本次尝试的处理范围；失败时必须以
`_state.json` 中仍然存在的维护区间为准，不能把它当作已提交边界。

通过显式模板运行的 Kubernetes Job 若出现 `BackoffLimitExceeded`，应读取 Pod 输出定位应用根因。
Ops 通知维护的部署环境响应来自 Temporal failure 与 Workflow result；`controllerError` 保留接口兼容字段，
不再表示 Kubernetes Job condition。本地任务错误来自 CLI 输出。

认证错误按 [内部门户认证](../access/portal-auth.md) 替换 TGC。对象摘要或 schema 不一致时保留明确失败，不能改写为部分
成功。

## 验证

```bash
pnpm --dir packages/contracts contracts:check
pnpm exec turbo run typecheck test --filter=ops-web --filter=ingestion-contracts --filter=internal-portal-collection --concurrency=1 --summarize
pnpm --dir apps/ops-web test:database-integration
pnpm --dir scripts typecheck:notices
pnpm exec tsx --test scripts/notices/*.test.ts
pnpm --filter notice-classifier typecheck
pnpm test --filter=notice-classifier
pnpm --filter notice-classifier build
pnpm --filter notice-publisher typecheck
pnpm test --filter=notice-publisher
pnpm test --filter=app-api
pnpm test --filter=campus-web
scripts/infra/validate.sh
```

这些检查验证源码、合同、当前统一 schema 的隔离数据库拓扑和 Kubernetes 期望配置，不证明集群已应用或
真实门户可用。Ops Web 凭据的环境检查见 [内部门户认证](../access/portal-auth.md)。

## 相关文档

- [通知领域（架构边界）](../../architecture/domains/notices.md)
- [通知数据](../../data/notices.md)
- [通知索引（Chunk 与 Embedding 制品）](./notice-indexing.md)
- [内部门户认证](../access/portal-auth.md)
