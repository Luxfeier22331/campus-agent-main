---
doc_type: phase_plan
phase: "2"
phase_name: "Registry Version Resolution"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Plan

## Objective

冻结 `versioned history query` 的第二层 runtime truth：
让 registry-backed resolver 在 retrieval 之前把 `current / historical / as_of / compare`
解析成 machine-readable version-selection truth，避免 retrieval backend、prompt 或 answer 层继续承担版本解析职责。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` 落地的 typed `version_query`
- 上游 planner 已能解析 `target_document_ids`
- registry 保存历史版本记录
- backend payload 已承载 `version_id`

当前 repo 还没有：

- registry version resolution 的正式输入/输出 seam
- `historical / as_of / compare` 的 code-owned 解析 owner
- 一个能稳定交给 `Phase 3` 翻译成 filter 的 resolved version truth

如果不先做这一步，后续 phase 会继续摇摆：

- compare pair 到底在哪里锁定
- as_of 到底是谁解析
- retrieval/backend 是否可以自己猜历史版本范围
- unresolved/fail-close 到底由谁负责

## Locked Inputs

- `Phase 1` 已固定 `current / historical / as_of / compare` 四个 mode。
- 无显式 version mode 的旧请求继续默认 `current`。
- 版本选择必须发生在 retrieval 之前。
- 当前已存在 resolved `target_document_ids` 上游 seam。
- 本 phase 不实现 retrieval filter translation 与 answer semantics。

## Decisions To Freeze

1. registry-backed resolver 是版本解析的 canonical owner。
2. resolver 只消费：
   - resolved `corpus/collection`
   - resolved `target_document_ids`
   - typed `version_query`
   - preferred revision-track/runtime profile context
3. resolver 不消费原始 user text，不承担 semantic/entity resolution。
4. resolver 输出必须是 typed selection truth，至少包含：
   - resolution status
   - resolved mode
   - 适用 `document_id`
   - resolved `revision_track`
   - 一侧或两侧的 `version_id` 集合
   - unresolved reason
5. `historical` 不允许静默退化到 `current`。
6. `as_of` 必须解析成单侧版本 truth 或 unresolved。
7. `compare` 必须解析成双侧版本 truth；若当前 protocol 不能表达足够 selector，本 phase 允许补最小 typed selector 扩展，但只能表达 version-axis anchor。
8. retrieval-core 在 `Phase 3` 之前不得承担 selector normalization。

## Execution Slices

### Slice 1: Freeze Resolver Contract Surface

- 在 `ingestion-core` 里定义 registry-backed version resolver 的 code-owned seam。
- 明确它是“resolver over registry data”，不是把 resolution 逻辑塞进 retrieval-core。
- 决定 resolver 返回的 typed dataclass/model 结构：
  - single-side selection
  - compare dual-side selection
  - unresolved status

### Slice 2: Add Registry History Enumeration Capability

- 为 `DocumentRegistry` 增补最小历史枚举 seam，例如 `list_versions(...)` 一类能力。
- 同步补齐：
  - `PostgresDocumentRegistry`
  - `InMemoryDocumentRegistry`
- 固定返回顺序与排序依据，避免 `as_of` / `historical` 的实现依赖隐式数据库行为。

### Slice 3: Decide Minimal Selector Inputs

- 评估现有 `VersionQuery(mode, as_of)` 是否足以支撑本 phase 的 resolution goal。
- 如果不足，只补最小 typed selector 扩展，限定为 version-axis anchor：
  - exact `version_id`
  - explicit `as_of`
  - bounded relative anchor
- 拒绝自由文本 selector、标题 match、关键词 query。

### Slice 4: Implement Resolver Behavior By Mode

- `current`
  - 解析当前有效版本 truth
- `historical`
  - 在已收敛的 document 范围内解析非当前版本 truth
  - 输入不足时返回 unresolved，而不是放宽成 current/all-doc retrieval
- `as_of`
  - 按时间点解析当时生效版本
- `compare`
  - 在同一 logical document 上锁定双侧版本 truth
  - 无稳定 pair 时返回 unresolved

### Slice 5: Freeze Unresolved / Fail-Close Semantics

- 为 resolver 输出固定 `unresolved_reason` 分类，至少覆盖：
  - missing_document_scope
  - version_anchor_missing
  - compare_pair_unresolved
  - as_of_unresolved
  - version_not_found
- 明确 unresolved 是正式输出，不允许下游把它当成“继续查 current”。

### Slice 6: Add Focused Tests

- registry history enumeration tests
- resolver mode tests：
  - current
  - historical
  - as_of
  - compare
- unresolved tests：
  - 多 document 未收敛
  - 缺少 selector anchor
  - 找不到目标版本
- 如发生 contract 扩展，同步补：
  - `tests/contracts/test_models.py`
  - `tests/api/test_supervisor_api.py`

## Proposed Write Set

- `packages/ingestion-core/src/campus_ingestion_core/registry.py`
- `packages/ingestion-core/src/campus_ingestion_core/in_memory_registries.py`
- `packages/ingestion-core/src/campus_ingestion_core/` 下新增 version resolver 模块
- `tests/ingestion/test_registry_models.py`
- 如 selector contract 需要最小扩展：
  - `packages/contracts/src/campus_contracts/models.py`
  - `packages/contracts/src/campus_contracts/__init__.py`
  - `apps/supervisor-api/src/campus_supervisor_api/api.py`
  - `tests/contracts/test_models.py`
  - `tests/api/test_supervisor_api.py`

## Verification Matrix

- resolver contract verification
  - repo 中存在正式的 registry-backed version resolver seam
  - resolver 输出是 typed truth，不是 dict/stringly-typed payload
- registry verification
  - `DocumentRegistry` 可稳定枚举某 document 的历史版本
  - in-memory 与 postgres 行为一致
- mode verification
  - `current` 返回当前版本 truth
  - `historical` 返回非当前版本 truth 或 unresolved
  - `as_of` 返回时间点版本 truth 或 unresolved
  - `compare` 返回双侧版本 truth 或 unresolved
- boundary verification
  - 本 phase 不修改 retrieval-core filter translation
  - 本 phase 不修改 `rag-agent` answer semantics
- fallback verification
  - unresolved 不会静默回退成 current retrieval

## Exit Rule

Phase 2 完成后，repo 应达到：

- registry-backed resolver 已成为历史版本解析的正式 owner
- `current / historical / as_of / compare` 已能在 retrieval 前解析成 version-selection truth
- unresolved/fail-close 语义已经 code-owned 固定
- `Phase 3` 可以只围绕 retrieval filter translation 工作，而不再承接 selector normalization
