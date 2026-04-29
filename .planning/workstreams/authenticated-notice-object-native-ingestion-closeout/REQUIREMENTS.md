---
doc_type: requirements
status: completed
created: 2026-04-28
updated: 2026-04-28
---

<!-- markdownlint-disable MD013 -->

# Requirements: Authenticated Notice Object-Native Ingestion Closeout

## Goal

把 authenticated notice source-channel 的主链路从本机 export handoff 收口到对象存储原生 handoff：

`collector run -> verified source bucket artifacts -> ledger refs -> worker import by object refs/run id -> canonical source-truth/document holding -> explicit downstream admission`

目标不是新增一个 query-serving surface，而是修正 data-plane ingestion 边界，使 Docker collector
和 Docker ingestion worker 可以只通过对象存储与关系型 run ledger 对接。

## Success Criteria

- collector success 必须要求 bundle、manifest 与 required source bytes 已写入对象存储并可验证。
- run ledger 必须保存 durable object refs、content hash / byte size / verification verdict，而不是只保存 local path。
- run ledger 必须有 Python worker 可消费的 read contract：按 `run_id` 读取 source
  surface、bucket、bundle/manifest refs、hash/size、status 与 verification summary。
- ingestion worker 支持从 `run_id` 或 explicit object refs 导入 bundle / manifest，不依赖本机 `runtime/exports`。
- ingestion worker 的 local path import 必须有代码级 fixture/dev guard；裸
  `--bundle-path` / `--manifest-path` 不能继续作为 Docker mainline 或生产 handoff。
- object ref 缺失、object 不存在、hash/size 不匹配时，worker fail closed，且不写 registry/projection/read model。
- `plan` / `dry-run` mode 只产出报告，不写对象存储、PG registry、projection、read model 或 current pointer。
- `file_release` 的目标姿态固定为 object-backed
  `authenticated_documents/file_release_source` source；它不进入 `notice`
  source-truth，也不自动进入 query-serving 或 downstream semantic promotion。
- WeChat、service-status、regulation 三类 notice-family ingestion consumers 进入兼容性验收矩阵：
  source refs、consumer admission、dry-run no-write 与 object-backed materialization 边界必须可验证。
- live repair 必须先产出 audit-only report 和 selected repair manifest；任何
  清理/标记/重建 stale rows 都必须有 row-id/object-key 级 manifest、备份导出与
  rollback notes。
- WeChat、service-status、regulation 的兼容性验收必须各自产出 acceptance artifact，
  不只依赖单元测试通过。
- 验收证据覆盖本地 object-store stub、MinIO/live object head、Docker collector -> worker handoff smoke。

## Non-Goals

- 不接手 `wechat-official-account-public-source-channel` 的 provider/discovery/body-capture
  业务决策；只验证其投影消费是否符合 object-native ingestion gate。
- 不接手 `authenticated-notice-service-status-consumption` 的 family 扩展、release 组合或 runtime
  opening；只验证 typed materializer 不回退到 raw/local source。
- 不重开 regulation target materialization quality gate；只消除 local bundle handoff 依赖与
  source ref 健康风险。
- 不打开 `campus_notices/internal_notice` query-serving、panel 或 chatbot serving。
- 不把 `file_release` 伪装成 `notice` source-truth。
- 不把本机路径、MinIO volume 路径或 Docker mount 路径写入长期 contract。
- 不让 collector 直接写 document registry、chunk、index 或 release。

## Captured Gaps

| Gap | Current Problem | Required Closure |
| --- | --- | --- |
| `AN-OBJ-01` | collector 写本机 `runtime/exports/*.json`，upload 只是附加动作 | collector handoff artifact 以 source bucket object refs 为唯一跨 runtime truth |
| `AN-OBJ-02` | worker import CLI 要求 `--bundle-path` / `--manifest-path` | 增加 `--run-id` 与 `--bundle-object-key` / `--manifest-object-key` object-native import |
| `AN-OBJ-03` | ledger 同时保存 local path 和 nullable object key | ledger schema/report 以 object refs、hash、size、verification verdict 为主，local path 仅允许 dev/debug |
| `AN-OBJ-04` | PG raw/inventory rows 可指向 missing object | import 前 head/get + checksum gate；missing object 不允许 registry/projection write |
| `AN-OBJ-05` | `file_release` 文档写 capture-only，但代码已有 `file_release_source` import 路径 | Phase 5 统一 target posture、schema、guard 和 docs |
| `AN-OBJ-06` | object upload failure 可局部记录但 run 仍可能形成成功口径 | required artifacts/source bytes 失败时 run status 为 failed，不产生 success handoff |
| `AN-OBJ-07` | dry-run / plan 语义需要跨 worker 固化 | tests 证明 dry-run 不写 object store、PG、projection、read model |
| `AN-OBJ-08` | Docker collector 与 worker 缺 object-ref handoff smoke | 增加容器级或 Docker-compatible smoke，不通过共享本机 export dir |
| `AN-OBJ-09` | live stale rows 缺可重复修复流程 | 增加 audit/purge/rebuild report，恢复为已采集待导入或干净缺失状态 |
| `AN-OBJ-10` | regulation publish wrapper 仍读取 local selected bundle | 改为 source-truth/object-ref selected import，或将 local bundle path 限定为 fixture |
| `AN-OBJ-11` | WeChat projection已能按 capture run/object refs 选择，但缺统一 object health gate | 纳入 source-truth artifact existence/checksum/dry-run no-write 验收 |
| `AN-OBJ-12` | service-status materializer依赖 projection truth，但需要防止回扫 raw/local source | 纳入 consumer admission + projection-only typed materialization guard |
| `AN-OBJ-13` | worker `--run-id` import 没有 Python-readable ledger resolver contract | Phase 1 冻结 read schema，Phase 3 实现 ledger reader |
| `AN-OBJ-14` | stale locator repair 缺 destructive-operation safety protocol | Phase 7 先 audit-only，再 selected repair manifest，再可回滚 repair |
| `AN-OBJ-15` | consumer compatibility 缺分支级 acceptance artifact | Phase 6 为 WeChat / service-status / regulation 分别生成 acceptance report |
| `AN-OBJ-16` | local path import 只靠 README 约束，代码仍可能被当成主链路 | Phase 3 增加 CLI/DTO 级 fixture guard 和测试，legacy `--bundle-path` 裸调用 fail closed |

## Object-Native Handoff Contract

Phase 1 必须冻结以下 contract；Phase 2 / Phase 3 不允许再临时发明字段：

- stable operation handle：`run_id`
- source identity：`source_channel=authenticated_notice_portal`、`source_surface`、`site_id`
- object-store identity：`source_bucket`
- bundle ref：`bundle_object_key`、`bundle_content_sha256`、`bundle_byte_size`
- manifest ref：`manifest_object_key`、`manifest_content_sha256`、`manifest_byte_size`
- verification summary：`verification_status`、`verified_at`、
  `required_source_object_count`、`verified_source_object_count`、
  `missing_source_object_count`、`checksum_mismatch_count`、
  `size_mismatch_count`
- lifecycle：`status` in `started | success | failed`、`failure_reason`、
  `started_at`、`finished_at`

Required object roles:

- `handoff_bundle`：`notice` 与 `file_release` 都必须存在、可 `HEAD`、hash/size 匹配。
- `handoff_manifest`：`notice` 与 `file_release` 都必须存在、可 `HEAD`、hash/size 匹配。
- `notice_attachment_source_bytes`：仅对 bundle 中声明为 `storage_provider=object_store`
  且进入 source-truth 的附件 bytes 强制验证；reference-only 或 terminal-miss 只能作为
  capture fact，不能伪造成 required object。
- `file_release_released_source_bytes`：`file_release` 进入
  `authenticated_documents/file_release_source` 前必须存在、可 `HEAD`、hash/size 匹配；
  `reference_only` file_release 只能停在 capture evidence，不能导入 document holding。

Python worker 的 `run_id` resolver 只能依赖上面的 ledger read contract；不能读取 TS
私有类型，也不能回退到 ledger 中的 local path。

## Local Path Fixture Guard

Phase 3 的代码验收必须包含：

- 主 importer CLI 支持 `--run-id` 或 explicit object refs 作为默认路径。
- local path import 只能通过显式 fixture/dev guard 进入，例如
  `--allow-local-fixture-import` 或独立 fixture command。
- 裸 `--bundle-path` / `--manifest-path` 调用必须 fail closed，并提示改用
  `--run-id` / object refs 或 fixture guard。
- Docker / production runbook 不得出现 local bundle / manifest handoff 示例。
- tests 覆盖裸 local path 拒绝、fixture guard 允许、object-ref import 成功。

## Acceptance Artifact Paths

Phase 6 / Phase 7 的 acceptance evidence 固定写入本 workstream 目录，避免散落到临时
work dir：

- WeChat:
  `.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-06-notice-consumer-compatibility-matrix/wechat-public-notice-acceptance.json`
- service-status:
  `.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-06-notice-consumer-compatibility-matrix/service-status-acceptance.json`
- regulation:
  `.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-06-notice-consumer-compatibility-matrix/regulation-acceptance.json`
- live object audit:
  `.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-07-live-repair-and-acceptance/object-locator-audit.json`
- selected repair manifest:
  `.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-07-live-repair-and-acceptance/selected-repair-manifest.json`
- Docker handoff acceptance:
  `.planning/workstreams/authenticated-notice-object-native-ingestion-closeout/evidence/phase-07-live-repair-and-acceptance/docker-handoff-acceptance.json`

## Boundary Decisions

- `authenticated_notice_portal/notice` 的 canonical source unit 继续是 `notice`。
- `authenticated_notice_portal/file_release` 不进入 `notice` source-truth；本
  workstream 的目标 posture 固定为独立
  `authenticated_documents/file_release_source` object-backed document source。
- source bucket 继续按 S3-compatible object storage 语义处理；本地 MinIO 只是实现。
- downstream consumption 必须从 source-truth/projection/admission manifest 继续，不允许 query time 回扫 raw bundle。
- WeChat、service-status、regulation 都属于 ingestion consumption graph；本 workstream
  验证共享边界与回流 guard，不替代各自专项 workstream 的业务语义 owner。
- `.planning/WORKSTREAMS.md` 中属于本 workstream 的变更只包括新增/更新本行状态；
  service-status 等相邻 workstream 的阶段状态更新必须由各自 owner 单独提交或明确归属。

## Source References

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
