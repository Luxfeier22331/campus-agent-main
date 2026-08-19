---
doc_type: runbook
owner_boundary: ingestion-data-plane
status: active
---

# 采集运行

## 范围

本文说明内部门户通知与文件发布采集、分类交接和通知发布。系统没有通用采集任务控制面、来源
callback、独立 run ledger 或自动 query target 发布；通知分类 Job 是独立的一次性阶段，不由采集自动触发。

## 前置条件

- ingestion-control bootstrap 和 migration 使用数据库 owner 连接；旧 staging 升级前，数据平面已经协调
  `campus_agent` 对 `ingestion_control` 的成员关系；
- source 与 derived bucket 使用各自对象存储凭据；
- ingestion-control 与 source-collector 来自同一 source revision；
- 使用本地命令时，已通过 `auth:pull` 从 ingestion-control 解析当前有效 TGC；使用 Job 入口时，已
  提供 ingestion-control 内部地址和既有内部 token。

## 数据库与本地进程

```bash
pnpm --filter ingestion-control schema:bootstrap
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
```

数据库 TLS 与运行变量见 `env/commands/ingestion-control-runtime.env.example`。ingestion-control
migration 使用 advisory lock，并在 `ingestion_control.schema_migrations` 校验已应用 SQL 的摘要；
migration 7 删除已退役的 ingestion Temporal 任务表，并将历史 schema、journal 和当前凭据表接管给
数据库 owner。通知分类模型类型由 execution-control migration 8 安装。Rust kernels 保留为独立命令，
不由 ingestion-control 调度。

## 文件发布

本地按门户库存分页采集文件发布：

```bash
pnpm --filter source-collector file:sync
```

命令固定并发 2。已有合法 `source.json` 时复用；普通单项失败继续并汇总，认证失败立即终止。结果只在
source bucket 保存 `file` 与 `source.json`，不解析 PDF。Job 等价入口为 `file:sync:job`，当前未部署。

## 本地通知流程

通知流程由独立、显式的步骤组成。采集不会自动分类或发布，publisher 也不会触发后续领域处理。

### 初始化与认证

```bash
pnpm dev:init
pnpm --filter source-collector auth:pull
pnpm --filter source-collector auth:check
```

`dev:init` 启动本地 RustFS、确保共享 source bucket 存在，并生成对象存储和本地 PostgreSQL 配置。
`auth:pull` 按 `portal-auth.md` 使用当前 Kubernetes context 和 namespace 调用 ingestion-control 凭据解析接口，
并原子更新受管理的适配器 `.env.local`；认证检查必须成功后才能请求门户。
本地通知命令随后直接使用拉取到的 TGC，不需要后台编排器。

### 小范围采集

根据目标数据范围明确日期边界，先完成小范围验证，再扩大同一来源范围：

```bash
NOTICE_START_DATE=YYYY-MM-DD
pnpm --filter source-collector notice:sync
pnpm --filter source-collector notice:status
pnpm --filter source-collector notice:backfill --start-date "$NOTICE_START_DATE"
pnpm --filter source-collector notice:status
```

运行前必须把 `YYYY-MM-DD` 替换为本次任务明确选择的日期；仓库不提供跨环境固定默认值。
首次 sync 只建立全局列表 head；后续 sync 采集新通知，历史内容必须显式 backfill。sync 与 backfill
不得并发执行。后续 sync/backfill 会自动下载正文引用的图片和附件；可以使用 `--concurrency 1..16`
控制资源下载并发，默认值为 4。成功后检查 source bucket 包含 `internal_portal/meta.json`、通知对象、
资源对象和 `_state.json`，并确认状态中的历史边界已经覆盖 `NOTICE_START_DATE`。来源对象必须通过版本化
schema，内部通知与外链字段必须成对合法；任一 source、资源或 metadata 失败时状态不能推进。通知数据
结构见 `../data/notices.md`。

### 资源审计和修复

正常采集已经包含资源下载。`notice:resources` 用于试点审计、历史库存修复和指定通知补齐：

```bash
NOTICE_ID=123456
pnpm --filter source-collector notice:resources --dry-run --notice-id "$NOTICE_ID"
pnpm --filter source-collector notice:resources --notice-id "$NOTICE_ID"
pnpm --filter source-collector notice:resources --dry-run --notice-id "$NOTICE_ID"
```

附件请求不使用 `notice_annex_path` 作为 URL，而是按
`/comsys-portal-notice-web/download?id=<annex-id>&notice_id=<notice-id>` 构造；单个图片或附件上限为
100 MiB。默认并发为 4，`--concurrency` 只接受 1 到 16。资源命令成功后再次 dry-run，目标范围必须
报告 `missing=0`。可以省略 `--notice-id` 审计或补齐全部已采集通知。外链通知不会触发外部正文或图片
抓取。

在启用自动资源采集前，先对已有库存执行一次全量 dry-run、apply、dry-run，确保历史 source 不再有缺失
资源。资源下载失败时重新运行相同命令即可，已成功写入的对象会被复用。

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

需要在本地验证在线 Job 的对象存储行为时，使用独立的 Job 模拟入口，不改变上述 JSONL 交接：

```bash
kubectl port-forward svc/execution-control-provider-snapshot 18002:8002

pnpm notice:classify:job:local \
  --notice-id "$NOTICE_ID" \
  --concurrency 2
```

该入口读取 `campus-agent-source`，并将 `notices/classifications/<notice-id>.json` 写入当前 worktree 的
derived bucket。它通过 port-forward 从 execution-control 读取一次当前通知分类模型设置；重复默认运行时
应跳过合法制品，`--notice-id` 始终强制重分类。它不读取模型环境变量，也不把 API key 写入本地文件。

### 在线分类 Job

在线分类使用独立的 `notice-classifier` 一次性 Job。它从 source bucket 读取全部通知，跳过已有合法
分类制品，只处理缺失或无效制品；传入 `--notice-id` 时只处理指定通知并强制重分类。Job 只向模型发送
原始标题，不消费正文、门户栏目或清洗结果：

```bash
kubectl create job \
  --from=cronjob/notice-classifier \
  notice-classifier-$(date +%Y%m%d%H%M%S)
```

默认并发为 2，单条最多三次尝试，失败以非零状态结束。已完成的在途制品会保留，重跑会按固定键复用；
不会自动继续下一阶段，也不会写 PostgreSQL。Job 启动分类阶段后从
`execution-control-provider-snapshot:8002` 读取一次当前通知分类模型设置，模型名和 provider 由 Ops Web
配置，不在镜像或 Kubernetes Secret 中固定。

### 单分类 schema

`dev:init` 创建 `notice_publisher` 角色并安装 `notices.*`。资源齐备且分类 JSONL 已完成完整性校验后，
先确认当前 migration：

```bash
set -a
. apps/app-api/.env.local
set +a
NOTICES_DATABASE_URL="$APP_API_SCHEMA_DATABASE_URL" pnpm --filter notice-publisher migrate
```

Migration 5 会删除旧领域集合和列，并增加非空 `category`，只接受空的 `notices.notices` 投影。已有
本地旧投影不能原地推断或迁移；先停止本地 publisher，清空通知与资源投影，再运行 migration：

```bash
set -a
. apps/app-api/.env.local
set +a
psql "$APP_API_SCHEMA_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c 'TRUNCATE notices.notice_assets, notices.notices;'
NOTICES_DATABASE_URL="$APP_API_SCHEMA_DATABASE_URL" pnpm --filter notice-publisher migrate
```

随后只能使用新 taxonomy 的模型分类重新发布。来源对象和 derived 内容寻址资源可以保留；旧分类文件不能
作为新 schema 输入。该操作只适用于本地投影，不是在线环境迁移步骤。

### 单条与批量发布

先发布一个通知：

```bash
INTERNAL_PORTAL_BASE_URL=https://portal.example.edu \
  pnpm --filter notice-publisher run publish \
  --classifications "$NOTICE_CLASSIFICATIONS" \
  --notice-id "$NOTICE_ID"
```

核对正文、外链、图片和附件后，省略 `--notice-id` 发布分类清单全部记录：

```bash
INTERNAL_PORTAL_BASE_URL=https://portal.example.edu \
  pnpm --filter notice-publisher run publish \
  --classifications "$NOTICE_CLASSIFICATIONS"
```

publisher 在数据库事务前完成来源读取、正文清洗、资源摘要计算和 derived 对象写入，再用单一事务
写映射、通知和资源 metadata。任一来源缺失、合同无效或已有投影冲突都会以非零状态停止；数据库不留
部分批次，已验证的内容寻址对象可在重跑时复用。相同输入必须幂等。

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

### 本地重建

正文清洗合同变化后，已有投影会按不可变校验明确冲突。本地验证可以只清空通知和资源投影，再从
保留的 source 对象和同一份模型分类清单完整重建：

```bash
set -a
. apps/app-api/.env.local
set +a
psql "$APP_API_SCHEMA_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c 'TRUNCATE notices.notice_assets, notices.notices;'
INTERNAL_PORTAL_BASE_URL=https://portal.example.edu \
  pnpm --filter notice-publisher run publish \
  --classifications "$NOTICE_CLASSIFICATIONS"
```

该步骤只适用于已经安装 classification V2 的 `dev:init` 本地数据库，不是集群迁移或 publisher 自动
更新模式。类型、组织、领域、内容形态映射和 source bucket 保持不变。

该流程没有自动分类、定时发布或自动双写。集群回填和发布必须由对应环境配置明确执行，本地验证结果不表示集群
已经更新。App API 与 Campus Web 的读取路径也不表示任一环境已经完成写入或部署。

## Kubernetes

`infra/k8s/ingestion-runtime/base/runtime` 包含 ingestion-control API、schema Job、凭据检查 CronJob 和
默认暂停的通知分类 CronJob 模板，不包含自动采集调度。Source Collector 镜像保留
`notice:sync:job` 与 `file:sync:job`，消费 `INGESTION_CONTROL_INTERNAL_URL`、既有
`OPS_WEB_INTERNAL_TOKEN` 和 source bucket 配置；采集 Job 仍需另行启用。通知分类 Job 复用已有
source/derived 对象存储 Secret，不新增数据库或模型 Secret。启用前须在环境中确认到
execution-control 快照端口的连通性；源码和 Kustomize 渲染不代表该运行时事实。

## 排查

文件发布先检查分页响应、逐项错误摘要、门户响应及两个固定 source 对象。通知先查看命令错误、
通知对象和 `_state.json`，不要手工推进边界来伪装成功。

认证错误按 `portal-auth.md` 替换 TGC。对象摘要或 schema 不一致时保留明确失败，不能改写为部分
成功。

## 验证

```bash
pnpm --dir packages/contracts check
pnpm exec turbo run typecheck test --filter=ingestion-contracts --filter=ingest-core --filter=ingestion-control --filter=source-collector --concurrency=1 --summarize
pnpm --dir apps/ingestion-control test:database-integration
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
