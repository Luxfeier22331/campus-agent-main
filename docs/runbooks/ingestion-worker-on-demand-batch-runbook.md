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

report 固定包含：

- `schema_version`
- `batch_kind`
- `status`
- `started_at` / `finished_at` / `elapsed_seconds`
- 每个 step 的 `command`、`exit_code`、`elapsed_seconds`、`peak_rss_kb`
- 若子命令 stdout 是 JSON，则记录 `stdout_json`

## Read-Only Preflight

调度前先确认 CLI、env bootstrap 与 operator DB lane 可用：

```bash
uv run --package campus-ingestion-worker \
  campus-ingestion-run-on-demand-batch --help

uv run --package campus-ingestion-worker python -m \
  campus_ingestion_worker.list_internal_notice_consumption_admissions \
  --collection internal_notice \
  --limit 5
```

不要把 `show_authenticated_notice_control_plane_status` 作为通用 preflight；它会读取
source attachment inventory 等对象存储 key，更适合具体 control-plane 审计。

## Authenticated Notice Closeout

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
  --object-store-concurrency 8 \
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
  --max-attempts 3 \
  --report-path .tmp/ingestion-reports/internal-notice-multimodal-$(date +%Y%m%d).json
```

只做 drain evidence、不立即 rebuild read model：

```bash
--skip-read-model-rebuild
```

## Scheduling Shape

低频 notice 场景建议使用 timer 拉起 CLI，而不是常驻进程。

systemd timer 的执行单元只需要调用统一入口，例如：

repo 已提供可复制到服务器的无 secret 文件：

- `scripts/run-internal-notice-multimodal-drain.sh`
- `infra/local/systemd/campus-ingestion-internal-notice.service`
- `infra/local/systemd/campus-ingestion-internal-notice.timer`

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
INGESTION_ON_DEMAND_REPORT_DIR=.tmp/ingestion-reports
```

约束：

- `WorkingDirectory` 必须指向当前部署 worktree，使 `.env` bootstrap 命中本 worktree
- 调度器只负责拉起 CLI，不写 source truth
- failure 以非零退出码和 JSON report 中的 failed step 为准
- report 目录应纳入 operator log/artifact 留存，不作为 canonical data-plane truth

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
