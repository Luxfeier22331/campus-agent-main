---
doc_type: state
status: completed
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# State: Authenticated Notice Object-Native Ingestion Closeout

## Current Position

- status: `completed`
- current phase: `Phase 7 complete`
- current slice: complete; only reopen on object-native handoff or locator evidence drift
- last activity: 2026-04-30
- last activity description: workstream closed with phase summaries, completed registry state,
  retained Phase 7 evidence, and fresh read-only local audit command sanity check

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

## Completed Phase 2 Tasks

- [x] Extend collector artifact store with object head/verify support.
- [x] Upload bundle and manifest payloads directly to the source bucket.
- [x] Persist bundle/manifest hash/size and source bucket in run ledger.
- [x] Add full run lifecycle status `started | success | failed`.
- [x] Persist verification summary and failure reason.
- [x] Fail collector success handoff when required objects are missing or mismatched.
- [x] Keep local export files as optional operator artifacts only.

## Completed Phase 3 Tasks

- [x] Add worker import request support for `--run-id`.
- [x] Add explicit bundle/manifest object-ref import for notice export.
- [x] Add explicit bundle/manifest object-ref import for file_release export.
- [x] Add Python run-ledger reader for verified object-backed collector runs.
- [x] Guard local `--bundle-path` / `--manifest-path` as fixture/dev-only.
- [x] Add object-ref import tests and local-path fail-close tests.

## Completed Phase 4 Tasks

- [x] Add explicit missing-object fail-close coverage.
- [x] Add object hash mismatch and size mismatch coverage.
- [x] Prove plan/dry-run cannot write object store, registries, projections, or read models.
- [x] Prove missing object failure leaves injected registries/projections/read models unwritten.
- [x] Extend file_release released source object verification beyond bundle metadata.

## Completed Phase 5 Tasks

- [x] Keep `file_release_source` as object-backed authenticated document source.
- [x] Require released source bytes object `bucket/object_key/sha256/byte_size`.
- [x] Verify released source object before raw/document/inventory writes.
- [x] Extend holding status with `captured_only`, `object_backed_source_ready`,
  `imported_holding`, and `downstream_admitted` stages.
- [x] Update architecture / contract / worker docs.

## Completed Phase 6 Tasks

- [x] Verify WeChat projection consumes explicit source-truth artifact refs and has dry-run no-write coverage.
- [x] Verify service-status materializer consumes projection + consumer admission truth without raw bundle scan.
- [x] Verify regulation document-site publish requires dry-run report before formal selected import.
- [x] Add Phase 6 compatibility evidence artifacts.

## Current Phase Tasks

- [x] Add audit-only authenticated notice object locator command.
- [x] Add selected repair manifest / backup / docker handoff evidence paths.
- [x] Run live object locator audit against PG + object store.
- [x] Run Docker-compatible collector -> object store -> worker import smoke.
- [x] Select and back up stale rows before any repair write.
- [x] Recollect and materialize all historical `file_release_capture` rows selected for repair.
- [x] Refresh object-locator audit and close the repair gap to zero.

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

- none

## Closeout Notes

- Retained Phase 7 evidence reports `3332 / 3332` required authenticated-notice object locators verified and `missing_object_count=0`.
- Fresh 2026-04-30 audit-only command executed successfully and wrote only to `/tmp`; the current local PG inventory returned zero rows, so it was treated as command sanity evidence rather than replacement for retained live evidence.
- Reopen only if collector/worker handoff regresses to local export paths, object locator audit finds missing required source objects, run-ledger `run_id` import breaks, or a notice-family consumer bypasses object/source-truth/projection/admission truth.

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
- Phase 3 worker object-ref import implemented:
  - notice and file-release import requests accept `run_id` or explicit
    source-bucket bundle/manifest object refs.
  - Python run-ledger reader validates source surface, success status,
    `verification_status=verified`, source bucket, hash, and byte size.
  - object-ref loader reads bundle/manifest bytes from S3-compatible object
    storage and validates optional hash/size fields.
  - bare local bundle/manifest paths fail closed unless
    `allow_local_fixture_import` / `--allow-local-fixture-import` is explicit.
  - worker console script exposes
    `campus-ingestion-import-authenticated-notice-export`.
- Phase 4 fail-close gates implemented:
  - object-ref bundle/manifest import reports `missing_bundle_object`,
    `missing_manifest_object`, `checksum_mismatch`, and `size_mismatch`.
  - `file_release_source` materialization verifies released source bytes before any write and
    reports `missing_source_bytes`, `checksum_mismatch`, or `size_mismatch`.
  - plan/dry-run tests prove injected object store, registries, projection, and read model remain
    unwritten.
- Phase 5 file-release target boundary implemented:
  - holding status reports `holding_stage` and `holding_stage_counts`.
  - `file_release_source` remains non-query-serving unless a downstream owner explicitly admits it.
- Phase 6 consumer matrix implemented:
  - WeChat, service-status, and regulation worker tests pass.
  - acceptance artifacts are retained under
    `evidence/phase-06-notice-consumer-compatibility-matrix/`.
- Phase 7 audit and evidence scaffolding implemented:
  - worker console script exposes
    `campus-ingestion-audit-authenticated-notice-object-locators`.
  - live evidence paths are retained under
    `evidence/phase-07-live-repair-and-acceptance/`.
  - fresh notice incremental collector run succeeded:
    `muc_internal_portal:notice:20260428T181953007Z`
    with `notices_collected=282`, `pages_fetched=15`, `detail_fetched=282`, and
    `required_source_object_count=307`.
  - fresh targeted file-release collector run succeeded:
    `muc_internal_portal:file_release:20260428T182624439Z`
    for `file_release_id=585` with `required_source_object_count=3`.
  - run-id worker materialization succeeded for both fresh runs:
    notice import wrote source-truth-only holdings for 282 notices without projection/read-model
    rebuild; file-release import materialized `file_release_source` row `585` as
    `imported_holding`.
  - stale `storageState.json` auth override bug was fixed so fresh operator cookies now replace
    stale stored `JSESSIONID/nginx/SSO_TGC` values before fallback request-context creation.
  - backup artifact was written to
    `evidence/phase-07-live-repair-and-acceptance/backup/file-release-capture-pre-recollect-20260429.json`
    before repair writes.
  - full historical repair batch succeeded for all remaining 55
    `campus_notices/file_release_capture` ids; evidence is retained at
    `evidence/phase-07-live-repair-and-acceptance/historical-file-release-recollect-batch-A.json`.
  - refreshed object-locator audit after repair reports `3332` locators checked, `3332`
    verified, `0` missing source byte objects, `0` checksum mismatches, `0` size mismatches,
    and no audit writes.
  - selected repair manifest now records the completed recollection set, the backup artifact, and
    zero remaining repair candidates.

## Resume Notes

Start with `ROADMAP.md` Phase 1 and read:

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `apps/authenticated-notice-collector/src/file-release-export-core.ts`
- `apps/authenticated-notice-collector/src/collector-run-ledger.ts`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_file_release_export.py`
