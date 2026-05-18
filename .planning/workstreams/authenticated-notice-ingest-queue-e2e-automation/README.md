---
doc_type: index
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Authenticated Notice Ingest Queue E2E Automation

本 workstream 负责把 authenticated notice 的未来主路径收口为无人值守链路：

`collector -> verified run ledger -> ingest queue -> ingestion worker -> source-truth/import -> media gate -> promotion -> downstream materialization/read-model -> smoke`

## Current Status

- status: `completed`
- current phase: `Final verification complete`
- phases complete: `9`
- baseline: authenticated notice run-level queue、verified ledger handoff、run consumer、consumer-owned media gate evidence manifest、downstream materialization guard、cleanup guard 与 captured-content smoke harness 已在当前 worktree 中落地。
- current slice: Phase 1-9、final verification/closeout、以及 verified captured run 的真实 Postgres/object-store source-truth-only execute smoke 已完成。
- live infra acceptance: `muc_internal_portal:notice:20260428T181953007Z` 已通过真实 queue consumer execute，queue final state 为 `succeeded`，document/raw registry 均写入 `282` 条 `campus_notices/internal_notice`。
- deferred by operator decision: local-only historical content 不自动入队；后续由 operator 手动触发 verified/repair ledger enqueue。
- lease hardening: full-run execute 超过默认 300 秒 lease 的缺口已修复；run-level consumer 现在会 heartbeat 续约，smoke wrapper 也暴露 `--lease-seconds` 并透传到 consumer。

## Problem

当前代码已经有 `notice_ingest` queue 基础能力：

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py`

本线当前剩余收口点是 consumer 侧生命周期和 operator 观测，而不是重新打开历史内容自动入队：

- live collector path 只在 verified run ledger 后 hand off `run_id`。
- already-collected historical path 由 operator 手动 enqueue verified/repair ledger row。
- consumer 必须 owns operations-dir evidence、downstream admission/materialization gate、cleanup posture 与 queue terminal/manual-review 状态。
- smoke 当前用于 captured-content path 结构验证；真实 infra acceptance 后置执行。

## Target Shape

未来 live path 固定为：

1. collector 完成 authenticated notice selected/incremental/backfill run。
2. collector 上传 handoff bundle / manifest / required source objects 到 S3-compatible source bucket。
3. collector 写入 `authenticated_notice_collector_run` ledger row，且 `status=success`、`verification_status=verified`。
4. collector 或外部 scheduler 只在 verified row 后 enqueue ingest job。
5. ingestion worker claim queue job，按 `run_id` 解析 ledger object refs，不读取本机 path。
6. worker 验证 source bucket objects 的 existence/hash/size。
7. worker 执行 source-truth/import 和 closeout planning/execution。
8. worker 自动生成 media candidate inventory、attempt ledger、closeout inventory、target admission manifest、cleanup dry-run、live source-object verification 和 strict audit。
9. strict audit 通过后才允许 promotion。
10. promotion 触发 downstream materialization/read-model rebuild。
11. smoke 从已采集内容和 queue job evidence 验证 source-truth、media gate、promotion、downstream read model 与 cleanup posture。
12. child task evidence 明确记录每个 source unit、media candidate、processor attempt、target admission、materialization 与 cleanup stage 的状态、profile、reason code、retry posture 和 progress events。

历史内容 replay path 固定为同一 contract：

1. 如果已有 verified run ledger row，只 enqueue `run_id`。
2. 如果只有本地 artifact，先上传到 source bucket 并创建 repair/synthetic run ledger row，记录 provenance。
3. 再 enqueue 同一 ingest job，禁止把 local path 直接塞进 production queue payload。

## Boundaries

- queue 是 scheduling/control-plane truth，不是 source truth。
- source truth 仍是 source bucket object refs、run ledger、bundle/manifest hash/size verification，以及 import 后的 canonical source-truth artifacts。
- collector 不写 document registry、projection、read model 或 index。
- ingestion worker 不依赖 collector 本地目录，不把 `--bundle-path` / `--manifest-path` 当 production handoff。
- 本线不重新定义 media gate 语义；它只把已硬化的 gate 接入无人值守主链路。
- 本线不打开 public query-serving surface；downstream materialization/read-model 仍受 explicit admission 控制。
- 本线不建设 product/API scheduler；调度可由 cron/systemd/Kubernetes Job 或 repo-owned CLI 驱动。
- 本线 Phase 9 不引入 RAGFlow runtime；只参考其 ingest task/process 设计，把本 repo 的 child task contract 和 processor profile 收口。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- future phase plans: `./phases/*/PLAN.md`
