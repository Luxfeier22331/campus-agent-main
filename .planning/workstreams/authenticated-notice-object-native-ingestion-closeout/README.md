---
doc_type: index
status: active
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Workstream: Authenticated Notice Object-Native Ingestion Closeout

这是 `authenticated-notice-object-native-ingestion-closeout` 的 native workstream
入口。

这条线负责把 authenticated notice / file_release 的采集到导入链路收口为：

`Docker collector -> S3-compatible object storage + run ledger -> Docker ingestion worker -> source-truth / document holding -> admitted downstream projection`

它修正的不是 notice 下游分类规则，而是 source-channel handoff 与 ingest 边界：

- collector 不能把本机 export path 当成跨 runtime handoff truth
- worker 不能只接受 `--bundle-path` / `--manifest-path` 本地文件
- PG registry / ledger 里的 object locator 必须能被对象存储验证
- dry-run / plan 不能写入 source-truth、registry、projection 或 read model
- `file_release` 必须有明确 target posture，不能一边文档写 capture-only，一边代码继续扩张为隐式 source

## Current Status

- status: `active`
- current phase: `Phase 7`
- current focus: Phase 7 live repair and acceptance closeout evidence
- implementation status: Phase 4-6 implemented and locally verified; Phase 7 audit command,
  selected repair manifest contract, backup evidence path, Docker handoff evidence, full
  historical `file_release_capture` recollection, and refreshed object-locator audit are now
  complete. The current source-bucket audit verifies `3332 / 3332` required authenticated-notice
  objects with `missing_object_count=0`.

## Owned Scope

- authenticated notice collector handoff artifact contract
- required object role matrix for bundle, manifest, notice attachment bytes, and
  file_release released source bytes
- collector run ledger object refs, verification summary, and Python-readable
  `run_id` resolver contract
- ingestion-worker object-ref / run-id import path
- ingestion-worker local path fixture/dev guard; local paths are not production
  handoff
- fail-close object existence / checksum / dry-run write gates
- `authenticated_notice_portal/file_release` target posture alignment
- notice-family ingestion consumer compatibility matrix:
  - WeChat public notice projection consumes source-truth object refs safely
  - service-status typed materializer consumes admitted projection truth safely
  - regulation materializer no longer depends on local export handoff
- live stale object locator repair and Docker acceptance evidence
  - audit-only first
  - selected repair manifest
  - backup artifact and rollback notes before repair writes

## Evidence Paths

Acceptance artifacts are retained under this workstream:

- Phase 6 consumer matrix:
  `./evidence/phase-06-notice-consumer-compatibility-matrix/`
- Phase 7 live repair and Docker handoff:
  `./evidence/phase-07-live-repair-and-acceptance/`

These paths are part of the workstream contract. Temporary command work dirs are
not sufficient closeout evidence.

## Non-Owned Scope

- WeChat provider selection, discovery login, mp.weixin capture parser, or source-channel
  rollout policy
- service-status family taxonomy expansion, runtime opening semantics, or product answer UX
- regulation semantic quality scoring, target collection acceptance thresholds, or query-serving
  opening
- notice query serving / panel product opening
- auth portal product scheduler or app-api control plane
- adjacent workstream status changes in `.planning/WORKSTREAMS.md`, unless
  explicitly assigned to this workstream

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`
