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

- status: `active`
- current phase: `Phase 1 planned`
- baseline: authenticated notice 状态机、media gate、strict audit、promotion guard 已在当前 worktree 中硬化；但主链路仍依赖人工拼接 artifact、手动执行 worker 命令和手动判断 smoke 证据。

## Problem

当前代码已经有 `notice_ingest` queue 基础能力：

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_store.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_ingest_queue_postgres.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_historical_enqueue.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_queue_consumer.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/enqueue_collected_notice_historical_inventory.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/consume_collected_notice_ingest_queue.py`

但这套能力仍不足以表达真正的 production-like 主路径：

- queue job 仍偏向 per-notice collected replay / searchable evidence 投影，而不是 collector verified run 的 durable handoff job。
- collector 成功后不会自动根据 run ledger verified row enqueue。
- 手动历史内容 enqueue 还没有统一的 run-ledger/object repair entrypoint。
- worker consumer 不会按 `run_id` 自动串起 import、closeout worker、media gate、promotion、downstream materialization 和 smoke。
- queue lifecycle 缺少 `manual_review`、`cancelled`、`blocked`、`retry_after` 等 production operator 态。
- strict media audit、live object verification、cleanup dry-run、promotion 和 downstream read-model rebuild 仍需要人工传 artifact 路径。
- smoke 仍主要验证单段命令输出，不能证明从队列到下游 materialized/read model 的无人值守路径。

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

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- future phase plans: `./phases/*/PLAN.md`
