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
- current phase: `Phase 2 auth-blocked`
- baseline: `86695c4b feat: 完成通知附件 fetch admission 收口`

## Problem

Phase 9 已让 collector 默认不下载 notice attachments，并支持读取
`AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH`。剩余缺口是 operator
侧没有稳定命令从 source-truth inventory 与 `attachment-refs.jsonl` 生成 collector 可消费的
fetch request manifest；README / runbook 也仍有“配置对象存储即 materialize attachments”的旧说法。

## Target Shape

固定 operator 链路：

`source-truth inventory + attachment-refs.jsonl -> fetch request manifest -> selected collector export -> run ledger verification -> import smoke`

边界：

- ingestion/operator 侧决定哪些 attachment refs 进入 `fetch_to_quarantine`、
  `fetch_required_for_source_truth` 或 `fetch_required_for_admitted_owner`。
- collector 只消费 manifest admission，不重新根据附件类型扩张下载范围。
- `metadata_only` refs 不下载、不计入 required source objects。
- required/admitted owner bytes 缺失时 fail closed；quarantine bytes 不阻断 source-truth。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`
