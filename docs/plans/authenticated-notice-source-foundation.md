---
doc_type: plan
status: active
created: 2026-04-03
updated: 2026-04-03
---

# Authenticated Notice Source Foundation

## 文档边界

本文只负责 `authenticated_notice_portal` source channel 的前向实施 handoff。

本文不负责：

- 替代 `docs/architecture/authenticated-notice-source-architecture.md` 的长期边界
- 替代 `ADR-0024` 的 source-channel / runtime ownership 决策
- 宣称该 source channel 已进入当前 merged truth

## 目标

把一套当前位于 repo 外的登录态内部通知采集器，重构成 `campus-agent` 可长期吸收的 source channel foundation，同时保持：

- collector runtime 与 data plane 分层
- typed bootstrap seam 只是过渡接入方式，不是长期 truth
- 首个下游 collection 默认 restricted 且 `offline_preparation`

## 实施问题

这份文档只回答六个问题：

- source channel 与首个 collection 的命名与目录如何冻结
- bootstrap import seam 要读什么、写什么
- canonical source-truth 需要哪些 artifacts
- collector 迁入 repo 时哪些模块保留、哪些模块重写
- restricted rollout 的默认发布顺序是什么
- 需要什么验证证据

## 已冻结默认值

本轮已确认以下默认值，不再继续作为开放问题：

- source channel：
  - `authenticated_notice_portal`
- collector app：
  - `apps/authenticated-notice-collector`
- 首个 collection：
  - `campus_notices/internal_notice`
- 发布姿态：
  - `restricted`
  - `offline_preparation`
- bootstrap seam：
  - 允许消费 export bundle + object-keyed attachments
  - 不把 SQLite / export schema 升级为长期 contract

## 实施顺序

### Wave 1：Collection Config And Import Contract Freeze

在 repo 内新增：

- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/canonical-profile.json`
- `configs/ingestion/campus_notices/internal_notice/chunk-profile.json`
- collection README

要求：

- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- canonical profile 明确 `notice` 是 primary source unit

同时在 `packages/ingestion-core` 冻结 import contract：

- importer 输入：
  - `notices-bundle-*.json`
  - blob/object manifest
  - typed collector metadata
- importer 输出：
  - `capture/*`
  - `provider/*`
  - `source-truth/*`
  - document registry inputs

### Wave 2：Bootstrap Importer

在 `packages/ingestion-core` 增加 authenticated notice importer，至少完成：

- 从 bundle 读取 notice metadata、正文 HTML、分类、links、attachments
- 基于 `site_id + notice_id` 生成 `raw_asset_id`
- 基于 notice 实质内容生成 `raw_version_id`
- 写 notice source-truth：
  - `notice-manifest.json`
  - `content-blocks.jsonl`
  - `attachment-refs.jsonl`
- 生成 document import inputs

在 `apps/ingestion-worker` 增加一个新入口命令，用于：

- backfill 一次性导入
- 局部重跑某个 notice 或某批 bundle

### Wave 3：Restricted Document Projection

把 importer 生成的 document import inputs 接到 registry / chunk pipeline。

最小要求：

- document registry 主写入 `visibility_level=restricted`
- 初始 `entitlement_groups` 使用明确的 restricted baseline
- 当前 collection 不开 query-serving

建议优先策略：

- 先独立 restricted collection
- 暂不混入 public collection

### Wave 4：Collector Repo Migration

把 repo 外 collector 迁入 monorepo 时，按下面拆分：

- 保留：
  - auth bootstrap / refresh
  - list/detail fetch
  - 正文 link/attachment enrich
  - object upload
- 降级：
  - SQLite 仅作为 app 内 cache / dedupe / runtime state
- 移除其系统间 truth 地位：
  - export JSON 不再是长期 repo contract

迁入后 collector 应直接产出 repo 认可的 typed artifacts，而不是继续要求 ingestion 只认旧 bundle shape。

### Wave 5：Optional Control Plane

如果后续需要持续调度、run ledger、operator read model，再新增 dedicated control-plane domain。

要求：

- 这是后续 wave，不阻塞 source-truth foundation
- 不复用 `official_web` command/query APIs
- 不让 `apps/ingestion-worker` 承担 collector control plane

## 代码落点建议

### Docs

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`

### Ingestion

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/import_authenticated_notice_export.py`

### Config

- `configs/ingestion/campus_notices/internal_notice/README.md`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/canonical-profile.json`
- `configs/ingestion/campus_notices/internal_notice/chunk-profile.json`

### Collector

- `apps/authenticated-notice-collector/`

## 验证要求

至少补齐以下验证：

- importer unit tests
  - stable `raw_asset_id` / `raw_version_id`
  - HTML -> content blocks conversion
  - attachment refs normalization
- registry/chunk tests
  - restricted projection write-in
  - no query-serving by default
- bootstrap smoke
  - 从一份真实 bundle 成功导入 source-truth + document registry
- leakage guards
  - restricted collection 未授权时不得进入公开 query path

## 推荐验证命令

Python baseline:

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

JS/TS baseline:

```bash
pnpm web:typecheck
pnpm web:test
pnpm web:build
```

## 当前不做

- 不在本轮把 `authenticated_notice_portal` 接成 public query surface
- 不在本轮落 panel / operator control plane
- 不在本轮把 collector 外部 repo 的命名或目录结构原样保留为长期 truth
