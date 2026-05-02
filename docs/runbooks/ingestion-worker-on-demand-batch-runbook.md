---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-04-27
---
# Ingestion Worker On-Demand Batch Runbook

## 文档边界

本文只回答 `apps/ingestion-worker` 如何按需执行离线 ingestion batch，并在执行结束后退出。

它不改变：

- data-plane canonical chain：仍以 `docs/architecture/system/data-plane-architecture.md`
  为准
- query-serving surface：仍由 collection runtime profile 控制
- app-api / supervisor-api 边界：ingestion worker 不接管在线回答编排

## Runtime Posture

当前默认姿态是：

- 不常驻完整 Python ingestion worker 进程
- 由 cron、systemd timer、外部调度器或 operator shell 按需拉起 CLI
- 每次 CLI 只处理 bounded batch，输出 JSON report，然后退出
- heavy ingestion dependencies 只在具体子命令进程中加载
- on-demand runner 负责 orchestration 与 resource profile，不拥有 source truth 或
  serving policy

这适合当前低频 notice / handoff 规模。若后续变成高频队列消费、需要 lease/backpressure 或
长时间并发协调，再重新评估 Go/Rust/TS runner。

## Unified Entry

统一入口：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  <batch-kind> \
  --report-path .tmp/ingestion-reports/<run-id>.json
```

安装脚本入口：

```bash
uv run --package campus-ingestion-worker campus-ingestion-run-on-demand-batch \
  <batch-kind> \
  --report-path .tmp/ingestion-reports/<run-id>.json
```

推荐的 operator shell 入口（preflight + lock + batch + retention）：

```bash
scripts/run-ingestion-worker-batch.sh <batch-kind> [batch args...]
```

report 固定包含：

- `schema_version`
- `batch_kind`
- `status`
- `started_at` / `finished_at` / `elapsed_seconds`
- 每个 step 的 `command`、`exit_code`、`elapsed_seconds`、`peak_rss_kb`
- 若子命令 stdout 是 JSON，则记录 `stdout_json`

report retention 命令：

```bash
uv run --package campus-ingestion-worker campus-ingestion-prune-reports \
  --report-dir .tmp/ingestion-reports \
  --max-age-days 14 \
  --max-count 200 \
  --keep-failed
```

## Read-Only Preflight

调度前先确认 CLI、env bootstrap 与 operator DB lane 可用：

```bash
uv run --package campus-ingestion-worker \
  campus-ingestion-run-on-demand-batch --help

uv run --package campus-ingestion-worker \
  campus-ingestion-preflight \
  --batch-kind internal-notice-multimodal-drain \
  --report-dir .tmp/ingestion-reports \
  --lock-dir .tmp/ingestion-locks

uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.list_internal_notice_consumption_admissions \
  --collection internal_notice \
  --limit 5
```

本地开发默认不加 `--live`，只做 CLI、env shape 与目录可写检查。服务器部署或 Docker image
上线前再运行 live gate：

```bash
uv run --package campus-ingestion-worker \
  campus-ingestion-preflight \
  --batch-kind internal-notice-multimodal-drain \
  --report-dir /var/lib/campus-agent/ingestion/reports \
  --lock-dir /run/campus-agent/ingestion \
  --live
```

`--live` 会对 Postgres 与 S3-compatible object storage 做真实连接探测；失败时返回非零退出码。

不要把 `show_authenticated_notice_control_plane_status` 作为通用 preflight；它会读取
source attachment inventory 等对象存储 key，更适合具体 control-plane 审计。

## Local Development Flow

当前还没有服务器侧时，按本地开发流程执行；不要安装或启动 systemd timer。

执行顺序：

1. 先确认当前 worktree `.env` 只指向 dev DB 与 dev object store。
2. 先跑 `Read-Only Preflight`，确认 CLI 与 operator DB lane 可用。
3. 再跑小批量 writable drain，并先跳过 read model rebuild：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  internal-notice-multimodal-drain \
  --limit 1 \
  --batch-size 1 \
  --max-attempts 1 \
  --consumer-admission-manifest-path \
  /path/to/internal-notice-consumer-admission-manifest.json \
  --skip-read-model-rebuild \
  --report-path .tmp/ingestion-reports/internal-notice-multimodal-local-smoke.json
```

1. 检查 report 中的 `status`、`failed_step`、`elapsed_seconds`、`peak_rss_kb`。
2. 只在上一步稳定后，才用小批量运行包含 read model rebuild 的 drain。

本地流程约束：

- 本地阶段不安装 `infra/local/systemd/*.service` 或 `*.timer`
- 不把 `--promote` 纳入本地首跑
- report 统一落到 `.tmp/ingestion-reports/`

本地也可直接走 unified shell，保持与服务器一致：

```bash
scripts/run-ingestion-worker-batch.sh internal-notice-multimodal-drain \
  --limit 1 \
  --batch-size 1 \
  --max-attempts 1 \
  --consumer-admission-manifest-path \
  /path/to/internal-notice-consumer-admission-manifest.json \
  --skip-read-model-rebuild
```

本地 DB env 默认只需要 shared dev Postgres：

```bash
CAMPUS_SHARED_POSTGRES_URL=postgresql://...dev...
CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgresql://...dev...
# legacy alias accepted by current worker builders:
CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL=postgresql://...dev...
```

internal notice 的 projection、admission、attempt 与 read model 是不同 logical ownership
surface；本地不需要为它们创建多套数据库。只有明确要隔离某个 logical store 时，才在当前
worktree `.env` 或命令级 env 中使用这些 override：

- `NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL`
- `NOTICE_CONSUMPTION_PROJECTION_OPERATOR_DATABASE_URL`
- `INTERNAL_NOTICE_READ_MODEL_DATABASE_URL`
- `INTERNAL_NOTICE_READ_MODEL_TABLE`
- `INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL`
- `INTERNAL_NOTICE_CONSUMPTION_ADMISSION_OPERATOR_DATABASE_URL`
- `INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL`
- `INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_DATABASE_URL`

## Official Web Release Tasks

official_web 的 selected-write / stable-reference release task 属于 ingestion data
plane。`apps/app-api` 只接收 worker 上报的 redacted operator projection；不提供 claim /
lease / retry / publish mutation。

本地或服务器按需执行 handoff replay 时，如果要把已通过 selected-write review 的 candidate
转成 release task，在 handoff consumer 加 admission flag：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  official-web-handoffs \
  --limit 20 \
  --admit-release-tasks \
  --report-path .tmp/ingestion-reports/official-web-handoffs.json
```

稳定参考面 release gate 已经由 eval/release gate 产出批准文件时，使用 ingestion-worker
入口显式 admission：

```bash
uv run --all-packages campus-ingestion-admit-official-web-release-gate \
  --release-gate-path /path/to/official-web-release-gate.json
```

执行已入队 task 使用独立 release task batch。它每次 claim 一个 task，推进 state
machine，并在配置 callback 后把 operator-safe snapshot 上报给 app-api：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  official-web-release-tasks \
  --worker-id official-web-release-task-runner \
  --work-dir ./var/official-web-release-tasks \
  --report-path .tmp/ingestion-reports/official-web-release-task.json
```

等价的 operator shell：

```bash
scripts/run-official-web-release-tasks.sh
```

生产/本地 env 至少需要：

- `OFFICIAL_WEB_RELEASE_TASK_DATABASE_URL` 或 shared `CAMPUS_SHARED_POSTGRES_URL`
- `OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_URL` 或
  `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` / `CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL`
- `OBJECT_STORE_ENDPOINT` / `OBJECT_STORE_ACCESS_KEY` / `OBJECT_STORE_SECRET_KEY`
- `INGESTION_WORKER_APP_API_BASE_URL`
- `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET`

命令级 override 示例：

- `env/commands/official-web-handoff-consumer.env.example`
- `env/commands/official-web-release-task.env.example`

如果只想先验证 admission，不执行 release task，运行 handoff consumer 时不要加
`--admit-release-tasks`。如果只想验证 task state machine，不回写 app-api，可留空
`INGESTION_WORKER_APP_API_BASE_URL` / `INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET`；
此时 app-api / panel 不会看到新的 projection。

本地 app-api 已启动时，可跑 release task projection smoke。它会创建一条本地 smoke
task、通过 ingestion-worker runner 推进、上报 projection，再从 app-api operator read
route 读回：

```bash
uv run --all-packages python -m scripts.official_web_release_task_local_smoke \
  --app-api-base-url http://127.0.0.1:8787 \
  --app-api-internal-shared-secret "$INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET"
```

## Authenticated Notice Closeout

### Ingest Queue Contract

`authenticated_notice_ingest_job.v1` 是 authenticated notice 的 run-level
ingest queue payload。它只调度已经写入 run ledger 且对象校验通过的 collector run。

固定要求：

- queue 是 scheduling truth，不是 source truth。
- source truth 仍由 source bucket object refs、collector run ledger、bundle/manifest
  hash/size verification 与 import 后 canonical source-truth artifacts 共同表达。
- queue payload 必须携带 `run_id`、`source_channel`、`source_surface`、`site_id`、
  source bucket、bundle/manifest object key、hash、size、enqueue source、priority、
  idempotency key、retry policy 与 provenance。
- queue payload 禁止携带正文、HTML、OCR payload、attachment bytes 或 local path。
- run-level idempotency 由 source channel、source surface、site id、run id、bundle hash
  与 manifest hash 共同决定。
- retryable failure 进入 `failed_retryable`，并通过 `next_retry_after` 控制下一次 lease；
  retry budget 耗尽后进入 `dead_letter`。
- strict media gate 或 repair ledger 缺口这类需要 operator 判断的失败应进入
  `manual_review` 或 `blocked`，不得伪装成 queued work。

当前已有 queue store 与生命周期基础，但完整无人值守链路仍按
`.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/ROADMAP.md`
分阶段推进。Phase 1 只冻结 queue contract 与 lifecycle；后续 Phase 才接入
collector auto-enqueue、run-level consumer、media gate、promotion、downstream
materialization 与 captured-content smoke。

Phase 9 之后，authenticated notice queue consumer 还必须输出
`authenticated_notice_child_task_state_contract.v1` 证据。operator 排查 pending /
manual-review / failed job 时，先看 child task summary，而不是直接打开原始 bundle 或 OCR
payload：

- `source_unit_import` 失败通常是 ledger / object-store / import contract 问题。
- `ocr_table_extraction` 或 `multimodal_enrichment` 失败说明 media processor
  或升级策略有问题。
- `target_admission` / `downstream_materialization` 失败说明 fact readiness
  或 read-model materialization 缺证据。
- `cleanup_evaluation` blocked 说明 destructive cleanup 缺少 fresh passed media
  gate evidence。

对 `355867` 这类 schedule facts 由图片承载的通知，processor profile 应为
`image_schedule_notice`，并且第一处理器必须是 OCR/table extraction；generic multimodal
只能作为明确 escalation。

首次从 export bundle 计划并执行：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  authenticated-notice-closeout \
  --run-id notice-$(date +%Y%m%d) \
  --bundle-path /data/authenticated-notice/export-bundle.json \
  --manifest-path /data/authenticated-notice/export-manifest.json \
  --site-id muc_internal_portal \
  --source-home-url https://portal.example.edu/home \
  --parallel-workers 1 \
  --worker-id notice-ondemand \
  --max-concurrency 1 \
  --notice-concurrency 2 \
  --object-store-concurrency 2 \
  --validate-chunking \
  --report-path .tmp/ingestion-reports/notice-$(date +%Y%m%d).json
```

已存在 planned run 时，只跑 worker：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  authenticated-notice-closeout \
  --run-id <existing-run-id> \
  --worker-id notice-ondemand \
  --validate-chunking \
  --report-path .tmp/ingestion-reports/<existing-run-id>.json
```

只有完成验证并明确需要推进 current truth 时才加：

```bash
--promote
```

默认建议：

- 当前每日十条级别，`--parallel-workers 1` 足够
- 若附件 OCR / Office normalization 明显堆积，再临时提高到 `2`
- 不把 `--promote` 写进无人工检查的首轮调度模板

## Official Web Handoff Consumer

消费 bounded handoff inbox：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  official-web-handoffs \
  --limit 20 \
  --report-path .tmp/ingestion-reports/official-web-handoffs-$(date +%Y%m%d%H%M%S).json
```

定点重放单个 event：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  official-web-handoffs \
  --event-id <event-id> \
  --limit 1 \
  --force \
  --report-path .tmp/ingestion-reports/official-web-<event-id>.json
```

默认不 promotion；需要 promotion 时显式加 `--promote`。

## Internal Notice Multimodal Drain

处理 notice consumption projection 中的 pending multimodal rows：

```bash
uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  internal-notice-multimodal-drain \
  --limit 100 \
  --batch-size 20 \
  --consumer-admission-manifest-path \
  /etc/campus-agent/internal-notice-consumer-admission-manifest.json \
  --max-attempts 3 \
  --report-path .tmp/ingestion-reports/internal-notice-multimodal-$(date +%Y%m%d).json
```

只做 drain evidence、不立即 rebuild read model：

```bash
--skip-read-model-rebuild
```

## Scheduling Shape

低频 notice 场景建议使用 timer 拉起 CLI，而不是常驻进程。

本节是未来服务器部署口径；本地开发阶段不要求安装或启动 timer。

systemd timer 的执行单元只需要调用统一入口，例如：

repo 已提供可复制到服务器的无 secret 文件：

- `scripts/run-ingestion-worker-batch.sh`
- `scripts/run-internal-notice-multimodal-drain.sh`
- `scripts/run-official-web-handoffs.sh`
- `scripts/run-authenticated-notice-closeout.sh`
- `scripts/run-wechat-public-notices.sh`
- `infra/local/systemd/campus-ingestion-internal-notice.service`
- `infra/local/systemd/campus-ingestion-internal-notice.timer`
- `infra/local/systemd/campus-ingestion-official-web-handoffs.service`
- `infra/local/systemd/campus-ingestion-official-web-handoffs.timer`
- `infra/local/systemd/campus-ingestion-authenticated-notice-closeout.service`
- `infra/local/systemd/campus-ingestion-authenticated-notice-closeout.timer`
- `infra/local/systemd/campus-ingestion-wechat-public-notices.service`

```ini
[Service]
Type=oneshot
WorkingDirectory=/srv/campus-agent
ExecStart=/srv/campus-agent/scripts/run-internal-notice-multimodal-drain.sh
```

脚本默认保持普通 CLI 入口，并支持通过环境变量覆盖 batch 参数：

```bash
INGESTION_ON_DEMAND_DRAIN_LIMIT=100
INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE=20
INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS=3
INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH=/etc/campus-agent/internal-notice-consumer-admission-manifest.json
INGESTION_ON_DEMAND_REPORT_DIR=.tmp/ingestion-reports
```

约束：

- `WorkingDirectory` 必须指向当前部署 worktree，使 `.env` bootstrap 命中本 worktree
- 调度器只负责拉起 CLI，不写 source truth
- failure 以非零退出码和 JSON report 中的 failed step 为准
- report 目录应纳入 operator log/artifact 留存，不作为 canonical data-plane truth

生产侧 hardening 目标：

- service 使用固定低权限用户，例如 `User=campus-ingestion`
- secrets 从 server-side env file 注入，例如
  `EnvironmentFile=/etc/campus-agent/ingestion-worker.env`
- `ExecStartPre` 先跑 `campus-ingestion-preflight --live`
- `TimeoutStartSec` 必须大于最大 batch 预算，但不能无限等待
- run script 使用 `flock` 或等价锁，避免 timer overlap
- `Environment=UV_CACHE_DIR=...` 并把 cache 目录放进 `ReadWritePaths`，避免
  `ProtectSystem=strict` 下 uv cache 初始化失败
- report dir、lock dir、working tree 权限只开放给 ingestion 用户
- journal tag / service name 固定，便于 failure alert 与 log lookup

## Docker Dev Lane

当前 worker 已提供 Docker image 构建与统一 batch entrypoint：

```bash
docker build \
  -f apps/ingestion-worker/Dockerfile \
  -t campus-ingestion-worker:dev \
  .
```

以 internal notice 小批量 smoke 为例：

```bash
docker run --rm \
  --memory=768m \
  --cpus=1 \
  --env-file /etc/campus-agent/ingestion-worker.env \
  -e INGESTION_ON_DEMAND_BATCH_KIND=internal-notice-multimodal-drain \
  -v "$(pwd)/.tmp/ingestion-reports:/var/lib/campus-agent/ingestion/reports" \
  -v "$(pwd)/.tmp/ingestion-locks:/var/lib/campus-agent/ingestion/locks" \
  campus-ingestion-worker:dev \
  --limit 1 \
  --batch-size 1 \
  --max-attempts 1 \
  --skip-read-model-rebuild
```

Docker 只负责跑 bounded batch，不应改造成常驻队列消费者。

## Failure Handling

出现 failed report 时：

1. 先看 `failed_step`
2. 查看该 step 的 `stderr_tail` 与 `stdout_json`
3. 对 authenticated notice closeout，优先用现有 repair/show 命令检查 run 状态
4. 对 official web handoff，保留 inbox record，通过 `--event-id --force` 定点重放
5. 不手动改写 registry/current pointer 来绕过 failed step

## Resource Review

每次 report 的 `peak_rss_kb` 用于观察实际 batch 资源。当前判断口径：

- 稳定低频 batch 不需要常驻服务
- 如果 `peak_rss_kb`、elapsed time 或 failed retries 随数据量增长出现趋势性上升，再评估
  batch size、concurrency 或 runtime shell 迁移
- 单次高峰不自动触发 Go 重写；先确认是 parser/OCR/provider/import path 的哪一段在占用资源
