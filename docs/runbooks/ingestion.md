---
doc_type: runbook
owner_boundary: ingestion-data-plane
status: active
---

# 采集运行

## 范围

本文说明注册 Rust 任务、内部门户文件发布 workflow 和本地通知命令。系统没有来源 callback、
独立 run ledger、文件发布离线发布流或自动 Campus Docs 索引激活。

## 前置条件

- ingestion migration 可以访问 PostgreSQL；
- source 与 derived bucket 使用各自对象存储凭据；
- Temporal namespace 可用；
- ingestion-control 与 source-collector 来自同一 source revision；
- `configs/ingestion` 中的 Rust registry 已通过校验；
- 使用内部门户本地命令或显式 worker 时，已从 Ops Web 取得目标 TGC 并通过直接变量配置。

## 数据库与本地进程

```bash
pnpm --filter ingestion-control schema:bootstrap
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

数据库 TLS 与运行变量见 `env/commands/ingestion-control-runtime.env.example`。migration 使用
advisory lock，并在 `ingestion_control.schema_migrations` 校验已应用 SQL 的摘要。当前 migration
会删除旧 source-collector/TypeScript 任务、父 pipeline 字段、离线发布表和旧通知边界表。

## 注册任务

调用方先把输入写入对象存储并计算摘要，再提交 `ingestion_task_envelope.v3`：

```bash
curl -fsS \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@${INGESTION_TASK_ENVELOPE_PATH}" \
  http://127.0.0.1:8000/internal/ingestion/tasks
```

任务必须由当前 registry 声明为 Rust kernel。canonical workflow ID 为 `ingestion/<task_id>`。
相同 task ID 只有在冻结输入一致时幂等；不同输入返回冲突。失败或取消的任务通过 Ops Web 使用
新 task ID 重试。

## 文件发布

文件发布只接受精确 ID，一次最多 50 个：

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "X-Operator-Id: operator@example.edu" \
  -H "Content-Type: application/json" \
  -d '{"request_id":"files-20260717","file_release_ids":[646,647]}' \
  http://127.0.0.1:8000/internal/ingestion/operations/internal-portal/file-releases
```

响应为每个 ID 返回独立 workflow ID。调用方用这些 ID 调用
`/internal/ingestion/operations/internal-portal/file-releases/status`，全部进入 Temporal 终态后停止
轮询。当前 Ops Web 不提供该操作入口。文件发布不创建 ingestion task；失败后使用新的 request ID
重新提交需要的文件 ID。

成功结果只在 source bucket 保存 `file` 与 `source.json`，具体合同见
`docs/contracts/internal-portal-file-release.md`。

## 本地通知流程

通知流程由独立、显式的步骤组成。采集不会自动分类或发布，publisher 也不会触发后续领域处理。

### 初始化与认证

```bash
pnpm dev:init
pnpm --filter source-collector auth:check
```

`dev:init` 启动本地 RustFS、确保共享 source bucket 存在，并生成对象存储和本地 PostgreSQL 配置。
开发者按 `portal-auth.md` 在未跟踪的适配器 `.env` 中提供当前 TGC；认证检查必须成功后才能请求门户。
本地通知命令不需要 ingestion-control API 或 Temporal。

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
不得并发执行。成功后检查 source bucket 包含 `internal_portal/meta.json`、通知对象和 `_state.json`，
并确认状态中的历史边界已经覆盖 `NOTICE_START_DATE`。来源对象必须通过版本化 schema，内部通知与外链
字段必须成对合法；任一对象或 metadata 失败时状态不能推进。通知数据结构见 `../data/notices.md`。

### 资源补齐

先对一个通知 dry-run，确认缺失集合后再下载：

```bash
NOTICE_ID=123456
pnpm --filter source-collector notice:resources --dry-run --notice-id "$NOTICE_ID"
pnpm --filter source-collector notice:resources --notice-id "$NOTICE_ID"
pnpm --filter source-collector notice:resources --dry-run --notice-id "$NOTICE_ID"
```

附件请求不使用 `notice_annex_path` 作为 URL，而是按
`/comsys-portal-notice-web/download?id=<annex-id>&notice_id=<notice-id>` 构造；单个图片或附件上限为
100 MiB。默认并发为 4，`--concurrency` 只接受 1 到 16。资源命令成功后再次 dry-run，目标范围必须
报告 `missing=0`。单条验证图片、附件名称、顺序和字节类型后，可以省略 `--notice-id` 补齐全部已采集
通知。外链通知不会触发外部正文抓取。

### 分类交接

分类脚本只读本地来源并把结果写到标准输出：

```bash
pnpm notice:classify --notice-id "$NOTICE_ID"
```

人员确认后，把一次性 `notice_id/domain` JSONL 保存到未跟踪路径，并设置：

```bash
NOTICE_CLASSIFICATIONS=/absolute/path/to/classifications.jsonl
```

每个通知只能出现一次且只能属于一个领域；尚未确认时使用 `unclassified`。分类文件不保存理由、
置信度、模型名称或原始响应，也不写入对象存储或 PostgreSQL。具体脚本输入见
`../../scripts/notices/README.md`。

### Schema 与历史附件链接

`dev:init` 创建 `notice_publisher` 角色并安装 `notices.*`。资源齐备且分类 JSONL 已人工确认后，
先确认当前 migration：

```bash
set -a
. apps/app-api/.env.local
set +a
NOTICES_DATABASE_URL="$APP_API_SCHEMA_DATABASE_URL" pnpm --filter notice-publisher migrate
```

只有已存在 migration 4 之前投影的本地数据库需要从 source JSON 回填附件来源 ID。该命令只更新
PostgreSQL metadata，不下载附件字节：

```bash
set -a
. jobs/notice-publisher/.env.local
set +a
pnpm --filter notice-publisher backfill-attachment-links --dry-run
pnpm --filter notice-publisher backfill-attachment-links
pnpm --filter notice-publisher backfill-attachment-links --dry-run
```

dry-run 必须没有缺失 ID 或序号冲突；apply 后的 `pending` 必须为 `0`。全新投影由 publisher 直接写入
附件 ID，不运行历史回填。

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

- 列表总数、分页，以及关键词、领域、来源、门户类型、发布部门和日期筛选；
- 站内正文通过清洗合同，标题不重复，图片按序号返回；
- 外链条目直接打开已校验来源，不进入站内详情；
- 附件显示 metadata 和门户原生链接，App API 不代理附件字节；
- 桌面与移动端没有正文、标签、日期或长附件名重叠；
- 未登录、空结果、无效参数、404 和依赖失败保留各自状态。

先完成一个站内通知、一个外链通知和一个含资源通知的浏览器验收，再扩大数据范围。本地对象和
PostgreSQL 结果不表示集群环境已经采集、发布或部署。

### 本地重建

正文清洗合同变化后，已有投影会按不可变校验明确冲突。本地验证可以只清空通知和资源投影，再从
保留的 source 对象和同一份人工确认分类清单完整重建：

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

该步骤只适用于 `dev:init` 生成的本地数据库，不是集群迁移或 publisher 自动更新模式。类型、组织、
领域映射和 source bucket 保持不变。

该流程没有定时任务或自动双写。集群回填和发布必须由对应环境配置明确执行，本地验证结果不表示集群
已经更新。App API 与 Campus Web 的读取路径也不表示任一环境已经完成写入或部署。

## Kubernetes

`infra/k8s/ingestion-runtime/base/runtime` 包含 API、migration 和两个 worker。环境 overlay 必须
提供数据库、对象存储、Temporal 和镜像摘要；源码 base 不创建认证 schedule，也不向
source-collector 注入 TGC。

source-collector 只能获得 source bucket 凭据。所有容器使用 non-root、只读 root filesystem；
临时下载文件只写 `/tmp`。内部门户 TGC 由 Ops Web 保存和定时检查；需要采集时由开发者在显式
本地进程中选择并传入，Kubernetes base 本身不开放已认证的文件发布执行。

## 排查

注册任务先检查 Temporal workflow、Rust Activity 和 PostgreSQL 投影。文件发布先检查返回的
workflow ID、source-collector Activity、门户响应及两个固定 source 对象。通知先查看命令错误、
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
pnpm --filter notice-publisher typecheck
pnpm --filter notice-publisher test
pnpm --filter notice-publisher test:migration-integration
pnpm --filter app-api test
pnpm --filter campus-web test
scripts/infra/validate.sh
```

这些检查验证源码、合同、隔离数据库 migration 和 Kubernetes 期望配置，不证明集群已应用或
真实门户可用。Ops Web 凭据的环境检查见 `portal-auth.md`。
