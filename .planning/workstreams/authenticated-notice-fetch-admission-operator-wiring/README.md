---
doc_type: index
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Workstream: Authenticated Notice Fetch Admission Operator Wiring

本 workstream 负责把 `notice-ingest-fact-state-machine` Phase 9 已完成的 collector
fetch admission 能力接到 repo-owned operator / ingestion-worker 工作流。

## Current Status

- status: `active`
- current phase: `Phase 7 completed; captured-content smoke next`
- baseline: `86695c4b feat: 完成通知附件 fetch admission 收口`

## Problem

Phase 9 已让 collector 默认不下载 notice attachments，并支持读取
`AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH`。operator / ingestion
contract 已补齐 media lifecycle、target-blocking admission、closeout provenance 与
attachment bytes availability guard。

当前优先级不是等待 live portal auth 做 fresh collector export，而是先用已采集内容证明
新状态机不会错误分流、错误保留 bytes、错误清理 target-blocking media，或把只应 search 的
notice 推进下游。

## Target Shape

固定 operator 链路仍然成立：

`source-truth inventory + attachment-refs.jsonl -> fetch request manifest -> selected collector export -> run ledger verification -> import smoke`

但当前 next slice 固定为已采集内容 smoke：

`captured source-truth/searchable replay -> fetch request recompute -> media readiness -> fact readiness -> closeout -> cleanup gate -> downstream replay/admission report`

边界：

- ingestion/operator 侧决定哪些 attachment refs 进入 `fetch_to_quarantine`、
  `fetch_required_for_source_truth` 或 `fetch_required_for_admitted_owner`。
- collector 只消费 manifest admission，不重新根据附件类型扩张下载范围。
- `metadata_only` refs 不下载、不计入 required source objects。
- required/admitted owner bytes 缺失时 fail closed；quarantine bytes 不阻断 source-truth。
- quarantine cleanup 删除过期 bytes 前必须检查 media extraction candidate inventory；
  `target_blocking=true` 且未进入 `completed` / `skipped` / `failed_terminal` 的 candidate
  仍引用该 object 时不得删除。
- fresh selected collector export 是 auth 可用后的 manifest-consumption proof；它不应阻塞
  当前已采集内容的状态机验收。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`
