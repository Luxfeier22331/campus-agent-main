---
doc_type: roadmap
status: active
created: 2026-04-28
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Authenticated Notice Object-Native Ingestion Closeout

## Overview

本 roadmap 处理 authenticated notice source-channel 的采集到导入边界，并把 WeChat、
service-status、regulation 作为 ingestion consumer compatibility matrix 纳入验收。
它不接管这些分支的 provider 选择、runtime opening、taxonomy 扩展或目标质量阈值。

## Phase Status

- [x] **Phase 1: Contract And Boundary Freeze** — 冻结 object-native handoff contract、run ledger read/write fields、worker import request shape，以及 `file_release` object-backed target posture。
- [x] **Phase 2: Collector Object-Native Handoff** — collector 直接产出 verified source-bucket bundle/manifest/source bytes refs，success run 必须有可验证 object refs。
- [x] **Phase 3: Worker Object-Ref Import** — ingestion worker 支持 `run_id` / object refs 导入，local path 降为 fixture/dev-only，不再是主链路 handoff。
- [x] **Phase 4: Fail-Close Object And Dry-Run Gates** — object existence/hash/size gate、dry-run no-write gate、missing object no registry/projection write。
- [x] **Phase 5: File-Release Target Boundary** — 将 `file_release` 从 capture-only drift 收口为显式 object-backed authenticated document source，并保持 query-serving / semantic promotion 关闭。
- [x] **Phase 6: Notice Consumer Compatibility Matrix** — 验证 WeChat、service-status、regulation 三类 ingestion consumers 都只消费 object/source-truth/projection/admission truth，不回退 local bundle/raw scan。
- [x] **Phase 7: Live Repair And Acceptance** — audit-only command、repair manifest contract、backup path 与 evidence 已落地；fresh notice / file_release collector run、run-id worker import smoke、55 条 historical `file_release_capture` recollection/import 与 refreshed object-locator audit 已完成，当前 `missing_object_count=0`。

## Phase 1: Contract And Boundary Freeze

**Goal:** 在动代码前把 object-native handoff 与 `file_release` 边界写清楚。

**Deliverables:**

- handoff contract：`run_id`、source surface、source bucket、bundle/manifest object refs、hash、size、verification verdict。
- required object role matrix：bundle、manifest、notice attachment source bytes、
  file_release released source bytes 各自的 required / optional / terminal-miss 语义。
- run-ledger read contract：worker 可按 `run_id` 读取 object refs、status、
  source surface、hash/size 与 verification summary。
- worker request contract：`run_id` 或 explicit object refs；local path 只能通过
  代码级 fixture/dev guard 使用。
- `file_release` target decision：固定为独立
  `authenticated_documents/file_release_source` object-backed document source。
- acceptance artifact contract：Phase 6 / Phase 7 evidence 必须写入本
  workstream 的固定 evidence 路径。
- docs 更新：architecture / file-release export contract / ingestion worker README。

**Verification:**

```bash
pnpm docs:lint
```

## Phase 2: Collector Object-Native Handoff

**Goal:** collector 不再把本机 export file 作为跨 runtime handoff truth。

**Scope:**

- 从 bundle/manifest payload 直接写 source bucket object，不要求 worker 读取 collector 本地文件。
- artifact store 增加 head/verify 能力；put 后校验 hash/size。
- run ledger 写入 bundle/manifest refs、required source byte refs、verification summary、failure status，并保留 worker reader 需要的 stable columns。
- required object upload/verify 失败时 run fail closed。

**Verification:**

```bash
pnpm --filter @campus/authenticated-notice-collector test
pnpm web:lint
```

## Phase 3: Worker Object-Ref Import

**Goal:** worker 从 object store / run ledger 获取 bundle 与 manifest。

**Scope:**

- `import_authenticated_notice_export` 支持 `--run-id`、`--bundle-object-key`、`--manifest-object-key`。
- `import_authenticated_notice_file_release_export` 支持同样 object-ref import。
- ingestion-core request DTO 支持 object refs，并通过 injected object store loader 读取。
- 增加 Python run-ledger reader；`--run-id` path 不直接复制 TS ledger
  internals，也不靠 local export path fallback。
- local path importer 保留为 test fixture/dev explicit path，且必须有 CLI/DTO 级
  guard；裸 `--bundle-path` / `--manifest-path` 不允许继续作为成功调用。
- tests 覆盖裸 local path fail closed、fixture guard allow、object-ref import success。

**Verification:**

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_import_authenticated_notice_export_worker \
  tests.ingestion.test_import_authenticated_notice_file_release_export_worker -q
uv run --all-packages ruff check apps/ingestion-worker packages/ingestion-core tests/ingestion
uv run --all-packages ruff format apps/ingestion-worker packages/ingestion-core tests/ingestion --check
```

## Phase 4: Fail-Close Object And Dry-Run Gates

**Goal:** 防止 metadata 指向缺失对象，防止 dry-run 写入。

**Scope:**

- object missing/hash mismatch/size mismatch 阻断 import。
- file_release released source object 必须可 head/get 并匹配 bundle sha256。
- plan/dry-run 使用 recording fake stores 证明没有 `put/upsert/replace/materialize`。
- partial failure 不写 source-truth inventory、raw registry、document registry、projection 或 read model。

**Verification:**

```bash
uv run --all-packages python -m unittest discover -s tests/ingestion -t . -q
uv run --all-packages ruff check packages/ingestion-core apps/ingestion-worker tests/ingestion
```

## Phase 5: File-Release Target Boundary

**Goal:** 统一 `file_release` 当前文档、代码和数据姿态。

**Target:** `file_release` 作为 `authenticated_documents/file_release_source` 的
object-backed authenticated document source，不进入 `notice` source-truth，不自动进入
regulations/service-status/query-serving。

**Required closure:**

- docs 从 capture-only 改成 explicit object-backed source posture。
- import admission 要求 released source bytes object-backed。
- document holding rows、raw assets、inventory rows 与 object refs 一致。
- downstream consumption 必须另走 target admission；本 phase 不打开 runtime。

**Verification:**

```bash
uv run --all-packages python -m campus_ingestion_worker.show_authenticated_document_holding_status \
  --collection file_release_source
uv run --all-packages python -m unittest tests.ingestion.test_authenticated_document_holding_status -q
pnpm docs:lint
```

## Phase 6: Notice Consumer Compatibility Matrix

**Goal:** 确认 notice-family ingestion consumers 没有被 object-native handoff
改坏，也没有继续依赖 local export 作为主链路 truth。

**Scope:**

- WeChat public notice projection:
  - consume capture run/object refs, not local body exports
  - dry-run does not write admission/projection/read model
  - missing source-truth artifacts fail closed
  - write acceptance artifact with selected refs, dry-run result, and missing-object fixture result at
    `evidence/phase-06-notice-consumer-compatibility-matrix/wechat-public-notice-acceptance.json`
- service-status typed materializer:
  - consume `notice_consumption_projection` + consumer admission manifest
  - no query-time or materialization-time raw bundle scan
  - preview/stage/promote semantics remain explicit
  - write acceptance artifact with input projection ids, publish mode, and no-raw-scan proof at
    `evidence/phase-06-notice-consumer-compatibility-matrix/service-status-acceptance.json`
- regulation materializer:
  - selected source import moves to object/source-truth refs where needed
  - local selected bundle path is test/dev fixture only
  - target quality gate remains owned by regulation workstream
  - write acceptance artifact with selected source refs and fixture-only local path proof at
    `evidence/phase-06-notice-consumer-compatibility-matrix/regulation-acceptance.json`

**Verification:**

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_project_wechat_public_notices_worker \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_publish_internal_notice_regulation_document_site_worker -q
```

## Phase 7: Live Repair And Acceptance

**Goal:** 把现有坏状态恢复为可审计、可重跑、可交接的状态。

**Scope:**

- audit 当前 PG object locators 与 source bucket object existence。
- 生成
  `evidence/phase-07-live-repair-and-acceptance/object-locator-audit.json`，
  不做写入。
- 生成
  `evidence/phase-07-live-repair-and-acceptance/selected-repair-manifest.json`，
  列出 row ids、object keys、repair action 与 rollback notes。
- 导出被选中修复 rows 的 backup artifact。
- 清理或标记 stale `file_release_capture` rows；必要时恢复为 captured-not-imported 状态。
- 用 Docker-compatible collector 产生 object-backed run。
- worker 只通过 run/object refs 导入。
- 生成
  `evidence/phase-07-live-repair-and-acceptance/docker-handoff-acceptance.json`：
  counts、object verification、dry-run no-write、import result、downstream untouched proof。

**Verification:**

```bash
pnpm web:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
git diff --check
```
