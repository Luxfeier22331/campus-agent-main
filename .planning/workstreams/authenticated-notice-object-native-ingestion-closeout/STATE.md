---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
---

<!-- markdownlint-disable MD013 -->

# State: Authenticated Notice Object-Native Ingestion Closeout

## Current Position

- status: `active`
- current phase: `Phase 2`
- current slice: collector object-native handoff
- last activity: 2026-04-28
- last activity description: Phase 1 contract/docs implemented; ready for collector handoff code

## Why This Workstream Exists

当前 authenticated notice 全链路存在边界偏差：

- collector 和 worker 的主 handoff 仍被本机 bundle/manifest path 牵引。
- run ledger / inventory / raw asset metadata 可以出现 object refs，但对象存储未被强制验证。
- `file_release` 文档仍写 capture-only，代码侧却已有 `file_release_source`
  import path，容易形成双真相。
- WeChat、service-status、regulation 都是 ingestion consumption graph 的一部分；
  不能被当成无关下游排除。它们需要进入 compatibility matrix，但专项业务语义仍由各自
  workstream 或既有 owner 负责。
- 用户目标态要求 Docker collector 与 Docker ingestion worker 通过对象存储和 run ledger 对接，全程不依赖本地文件系统作为系统间 truth。

## Completed Phase 1 Tasks

- [x] Freeze object-native handoff contract.
- [x] Freeze `source_bucket` and required object role matrix.
- [x] Freeze worker object-ref import request shape.
- [x] Freeze local path fixture/dev guard and rejection tests as Phase 3 code requirements.
- [x] Freeze run ledger verification fields and status semantics.
- [x] Freeze Python-readable run-ledger read contract.
- [x] Document `file_release` object-backed target posture.
- [x] Add WeChat / service-status / regulation ingestion consumer compatibility matrix.
- [x] Freeze Phase 6 / Phase 7 acceptance artifact paths.
- [x] Add live repair audit-only / selected manifest / rollback protocol.
- [x] Confirm docs/code write set for Phase 2.

## Current Phase Tasks

- [x] Extend collector artifact store with object head/verify support.
- [x] Upload bundle and manifest payloads directly to the source bucket.
- [x] Persist bundle/manifest hash/size and source bucket in run ledger.
- [x] Add full run lifecycle status `started | success | failed`.
- [x] Persist verification summary and failure reason.
- [x] Fail collector success handoff when required objects are missing or mismatched.
- [x] Keep local export files as optional operator artifacts only.

## Known Non-Overlap

- WeChat provider/body capture remains owned by `wechat-official-account-public-source-channel`;
  this line only owns shared ingestion gate compatibility.
- service-status family/runtime semantics remains owned by
  `authenticated-notice-service-status-consumption`; this line only owns no-local-source
  consumer compatibility.
- regulation quality and target acceptance remain completed unless object-native import changes
  their explicit handoff/admission contract.
- `.planning/WORKSTREAMS.md` service-status Phase 9 status is adjacent workstream state.
  Do not claim it as this workstream's change unless explicitly assigned.

## Blockers

- None for planning.
- Phase 7 live repair will require valid object store and database credentials.

## Verification

- Planning docs added.
- Phase 1 docs implemented:
  - `docs/architecture/domains/authenticated-notice/architecture.md`
  - `docs/reference/authenticated-notice-file-release-export-contract.md`
  - `apps/ingestion-worker/README.md`
- Phase 2 collector object-native handoff implemented:
  - S3 artifact store verifies object `HEAD` after `PUT`.
  - bundle/manifest uploads serialize directly from in-memory payloads and
    return source bucket, hash, size, and object refs.
  - collector run ledger records source bucket, hash/size, verification summary,
    started/success/failed lifecycle, and failure reason.
  - notice and file-release exports fail closed when verified source-bucket
    handoff cannot be completed.
  - local export files are disabled by default and only written when
    `AUTHENTICATED_NOTICE_WRITE_LOCAL_EXPORTS=true`.

## Resume Notes

Start with `ROADMAP.md` Phase 1 and read:

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `apps/authenticated-notice-collector/src/file-release-export-core.ts`
- `apps/authenticated-notice-collector/src/collector-run-ledger.ts`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_file_release_export.py`
