---
doc_type: runbook
owner_boundary: ingestion-data-plane
status: active
---

# 采集运行

## 范围

本文说明内部门户通知与文件发布采集、分类交接和通知发布。系统没有通用采集任务控制面、来源
callback、独立 run ledger 或自动索引发布；通知分类 Job 是独立的一次性阶段，不由采集自动触发。

## 前置条件

- 统一 schema bootstrap 使用数据库 owner 连接；Ops Web 凭据表最终位于
  `internal_portal.credentials`，历史环境由 Ops Web handoff migration 一次性接管；
- 通知采集、分类和发布共享 `notices.*`；本地和集群都由 `campus-agent-schema` 安装；
- source 与 derived bucket 使用各自对象存储凭据；
- Ops Web 与 internal-portal-collection 来自同一 source revision；
- 使用本地命令时，已通过 `internal-portal:auth:pull` 从 Ops Web 解析当前有效 TGC；使用 Job 入口时，
  已提供 `OPS_WEB_INTERNAL_URL` 和既有内部 token。

## 数据库与本地进程

```bash
pnpm dev:shared-reconcile
pnpm dev:init -- --target internal-portal-collection
pnpm --filter ops-web dev:api
```

数据库 TLS 与运行变量见 Ops Web 的环境合同。新建本地数据库使用
`drizzle.campus_agent_migrations`；现有部署环境的旧 ledger 和 handoff migration 原样保留，且不会被
统一 Job 自动接管。`notice-publisher` target 是统一 schema Job 和通知分类 seed 的 owner；
`internal-portal-collection` target 只生成 Ops Web 与采集器实际读取的环境投影，并通过 readiness 复用已完成的
schema，不执行重复 DDL。`notice-classifier` target 只生成 Model Config 与分类器实际读取的环境投影。
execution-control 的历史通知分类模型设置只作为 Model Config 一次性迁移输入，不构成当前配置所有权。

## 文件发布

本地按门户库存分页采集文件发布：

```bash
pnpm internal-portal:collect -- --mode file-sync
```

命令按顺序逐条处理。已有合法 `source.json` 时复用；普通单项失败继续并汇总，认证失败立即终止。结果只在
source bucket 保存 `file` 与 `source.json`，不解析 PDF。线上使用同一采集实现和固定为 `file-sync` 的
独立 Job 模板。

## 本地通知流程

通知流程由独立、显式的步骤组成。采集不会自动分类或发布，publisher 也不会触发后续领域处理。

### 初始化与认证

```bash
pnpm dev:init -- --target internal-portal-collection
pnpm internal-portal:auth:pull
pnpm internal-portal:auth:check
```

`internal-portal-collection` target 会准备当前 worktree 的 schema、通知分类 seed、Ops Web 和采集器环境；
采集器环境包含 source bucket 与通知数据库连接。`notice-classifier` target 同样准备 schema、通知分类 seed，
并生成 Model Config URL 与分类器环境。两者不维护 package-level 初始化入口，也不重复执行 DDL。
`internal-portal:auth:pull` 按 `portal-auth.md` 使用当前 Kubernetes context 和 namespace 调用 Ops Web
凭据解析接口，并原子更新受管理的适配器 `.env.local`；认证检查必须成功后才能请求门户。
本地通知命令随后直接使用拉取到的 TGC，不需要后台编排器。

### 小范围采集

通知维护状态是日期半开区间 `M=[start,end)`：`start` 包含，`end` 排除。两个采集 Job 各自只负责一侧：

- `notice-sync` 发现门户最新边界 `P`，采集 `[end,P)`，成功后把状态推进到 `[start,P)`；
- `notice-backfill --start-date S` 采集 `[S,start)`，成功后把状态扩展到 `[S,end)`。

首次初始化必须先从约定起点 `2025-12-01` 回填，再运行 sync。根据目标数据范围明确日期边界，先完成
小范围验证，再扩大同一来源范围：

```bash
NOTICE_START_DATE=2025-12-01
pnpm internal-portal:collect -- --mode notice-backfill --start-date "$NOTICE_START_DATE"
pnpm internal-portal:collect -- --mode notice-sync
```

回填起点必须是本次明确选择的日期；当前首次初始化约定为 `2025-12-01`。没有完整 v3 区间时，sync
会拒绝运行。适配器把内部排他上界转换为门户闭区间 `end_date` 的前一天，并用详情发布时间再次执行
`[start,end)` 校验。sync 与 backfill 通过 PostgreSQL advisory lock 串行执行，不能并发运行。后续
sync/backfill 会按顺序下载正文引用的图片和附件。成功后检查 source bucket 包含
`internal_portal/meta.json`、通知对象、已成功采集的资源对象和 `_state.json`，确认 v3 状态中的
`covered_from/covered_until` 区间符合本次 Job，且对应通知已登记到
`notices.notices`。来源对象必须通过版本化 schema，内部通知与外链字段必须成对合法；source、metadata、库存登记或
非永久缺失的资源传输失败时状态不能推进。通知附件明确返回 HTTP 404 时保留 source metadata、跳过附件资源对象，
继续登记通知并允许状态推进；发布时该附件不进入 `notice_assets`。图片 404、附件的其他 HTTP 错误、超时、流中断
和对象存储失败仍然阻止推进。附件
请求按门户附件 ID 和通知 ID 构造，单个图片或附件上限为 100 MiB；外链通知不会触发外部正文或图片
抓取。仓库不提供独立的资源维护或状态查看命令。通知数据结构见 `../data/notices.md`。

### 本地分类交接

分类脚本只读本地来源并把结果写到标准输出：

```bash
pnpm notice:classify --concurrency 2 --notice-id "$NOTICE_ID"
```

该命令是 JSONL stdout 交接和离线模型比较入口，由调用进程显式提供模型连接，生成一次性的
`notice_id/category` JSONL；它不读取或修改 execution-control 的在线模型设置。整批成功后把结果保存到
未跟踪路径，并设置：

```bash
NOTICE_CLASSIFICATIONS=/absolute/path/to/classifications.jsonl
```

每个通知只能出现一次，并具有一个共享合同允许的分类；标题不足以判断唯一分类时才使用
`unclassified`。单条通知对临时 provider 和非法结构化输出最多尝试三次，耗尽预算后整批失败。
分类文件不保存理由、置信度、模型名称或原始响应，也不写入对象存储或 PostgreSQL。
具体脚本输入和平衡模型评估见 `../../scripts/notices/README.md`。

需要在本地验证在线 Job 时，使用同一数据库实现：

```bash
kubectl port-forward svc/model-config 18003:8000

pnpm notice:classify:job:local \
  --model-config-url http://127.0.0.1:18003 \
  --notice-id "$NOTICE_ID" \
  --concurrency 2
```

该入口从当前 worktree 的通知数据库读取 ID 与标题，并写回 `category`。默认运行只分类
`category IS NULL` 的通知；`--notice-id` 明确覆盖指定通知的当前分类。它不读取独立模型凭据，也不把
API key 写入本地文件。

### 在线分类 Job

在线分类使用独立的 `notice-classifier` 一次性 Job。它从数据库读取待分类通知；传入 `--notice-id` 时
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

`pnpm dev:init -- --target notice-publisher` 创建本地 `notice_publisher` 角色，并使用数据库 owner 安装
`notices.*`。该 target 可安全重跑，并会应用当前尚未安装的 migration：

```bash
pnpm dev:init -- --target notice-publisher
```

Migration 6 将 `category` 改为可空，增加 `is_published`，并把迁移前已有通知标记为已发布。新采集通知
默认未分类、未发布，直接在既有库存上迁移，不清空通知或资源表。

线上由 `data-postgres` Application 中的 `campus-agent-schema` Job 使用既有 `campus_agent` owner Secret
执行统一 migration，不创建线上 `notice_publisher` 角色。

### 单条与批量发布

默认入口读取数据库中的待发布通知。先发布一个通知：

```bash
pnpm --filter notice-publisher run publish --notice-id "$NOTICE_ID"
```

核对正文、外链、图片和附件后，省略 `--notice-id` 发布所有已分类且未发布的通知：

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
摘要计算；图片立即写入 derived 内容寻址对象，附件只读取校验并留在 source bucket。随后用单一事务写
正文、资源 metadata 和发布状态；重新发布只更新正文投影并保持已发布状态。任一来源缺失、合同无效或
资源投影冲突都会以非零状态停止；
数据库不留部分批次，已验证的内容寻址图片可在重跑时复用。相同输入必须幂等。

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

该流程没有自动分类、定时发布或自动双写。集群回填和发布必须由对应环境配置明确执行，本地验证结果不表示集群
已经更新。App API 与 Campus Web 的读取路径也不表示任一环境已经完成写入或部署。

## Kubernetes

`infra/k8s/ops-web/base` 提供 Ops Web API、数据库授权 Job 和 `ops-web-internal-portal-check` CronJob；
`infra/k8s/ingestion-runtime/base/runtime` 只包含三个默认暂停的内部门户采集模板、通知分类和通知发布
CronJob 模板，不包含自动采集或发布调度。internal-portal-collection 镜像的 Job 入口消费
`OPS_WEB_INTERNAL_URL`、既有
`OPS_WEB_INTERNAL_TOKEN` 和 source bucket 配置；通知增量与回填还使用既有数据库 owner 连接登记通知
库存。三种采集模式都只能由维护者显式创建一次性 Job：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-sync <job-name>

kubectl -n <namespace> create job \
  --from=cronjob/notice-backfill <job-name> \
  --dry-run=client -o yaml |
kubectl set env --local -f - \
  INTERNAL_PORTAL_NOTICE_START_DATE=YYYY-MM-DD -o yaml |
kubectl -n <namespace> create -f -

kubectl -n <namespace> create job \
  --from=cronjob/file-sync <job-name>
```

三个模板各自固定一种动作，不接收 `mode`。回填日期只属于本次 Job，不写入长期环境配置。通知 Job
在 stdout 输出 `processedRange`、`maintenanceRange` 和 `scanning/processing/writing/finalizing` 结构化进度；
最终通知摘要只输出数量，不输出完整 ID 列表。sync 和 backfill 是两个独立 Job，任务中心只显示实际创建的 Job，
不自动创建另一条。

通知分类 Job 复用既有数据库 owner Secret、PostgreSQL CA 和 Model Config，不读取对象存储，也不新增
分类器专用数据库身份或模型 Secret。运行一次性采集 Job 前须在目标环境确认到 Ops Web、source bucket、
PostgreSQL 和门户 HTTPS 的连通性。

统一 `campus-agent-schema` Job 使用既有数据库 owner Secret 和 PostgreSQL CA。发布模板同样复用 owner
与 source/derived 对象存储 Secret，不新增线上 publisher Secret。全量发布直接创建一次性 Job：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-publisher <job-name>
```

代表性发布只替换该次 Job 的参数：

```bash
kubectl -n <namespace> create job \
  --from=cronjob/notice-publisher <job-name> \
  --dry-run=client -o yaml |
kubectl patch --local -f - --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":["publish","--notice-id","123456"]}]' \
  -o yaml |
kubectl -n <namespace> create -f -
```

## 排查

文件发布先检查分页响应、逐项错误摘要、门户响应及两个固定 source 对象。通知先查看命令错误、
Job 的 `processedRange`、`maintenanceRange`、`progress`、原始应用错误、`controllerError`、通知对象和
`_state.json`，不要手工推进边界来伪装成功。`processedRange` 只说明本次尝试的处理范围；失败时必须以
`_state.json` 中仍然存在的维护区间为准，不能把它当作已提交边界。

Kubernetes 的 `BackoffLimitExceeded` 表示 Job 控制器观察到 Pod 失败次数达到 `backoffLimit`；本项目固定
`backoffLimit: 0`，所以它不是应用根因。应用根因应从任务的 Pod 原始输出中读取，Ops Web 会把它放在
`error`，并把 controller reason/message 单独放在 `controllerError`。调试阶段两者均不脱敏、不泛化、不截断。

认证错误按 `portal-auth.md` 替换 TGC。对象摘要或 schema 不一致时保留明确失败，不能改写为部分
成功。

## 验证

```bash
pnpm --dir packages/contracts check
pnpm exec turbo run typecheck test --filter=ops-web --filter=ingestion-contracts --filter=internal-portal-collection --concurrency=1 --summarize
pnpm --dir apps/ops-web test:database-integration
pnpm notice:classify:typecheck
pnpm exec tsx --test scripts/notices/*.test.ts
pnpm --filter notice-classifier typecheck
pnpm --filter notice-classifier test
pnpm --filter notice-classifier build
pnpm --filter notice-publisher typecheck
pnpm --filter notice-publisher test
pnpm --filter notice-publisher test:migration-integration
pnpm --filter app-api test
pnpm --filter campus-web test
scripts/infra/validate.sh
```

这些检查验证源码、合同、隔离数据库 migration 和 Kubernetes 期望配置，不证明集群已应用或
真实门户可用。Ops Web 凭据的环境检查见 `portal-auth.md`。
