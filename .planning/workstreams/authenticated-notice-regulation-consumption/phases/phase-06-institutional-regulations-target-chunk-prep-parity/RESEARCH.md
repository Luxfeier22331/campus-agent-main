---
phase: "6"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 6 Research

## Purpose

把 `Phase 6: Institutional Regulations Target Chunk-Prep Parity` 建立在三类事实之上：

- repo 已经存在的 `institutional_rules` / `scoped_rules` target-side chunk-prep code 与测试
- 当前 `offline_preparation` stop point 与 target-side acceptance runbook
- 官方向量检索产品对显式 metadata / filtering / ranking 的当前建议

## Repo Pattern Readings

- `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/ROADMAP.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/STATE.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-05-target-side-quality-acceptance/CONTEXT.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-06-institutional-regulations-target-chunk-prep-parity/CONTEXT.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_institutional_regulation_chunk_prep.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_chunk_prep.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/prepare_institutional_regulation_chunks.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/prepare_scoped_rule_chunks.py`
- `tests/ingestion/test_internal_notice_institutional_regulation_chunk_prep.py`
- `tests/ingestion/test_internal_notice_scoped_rule_chunk_prep.py`
- `tests/ingestion/test_prepare_institutional_regulation_chunks_worker.py`
- `tests/ingestion/test_prepare_scoped_rule_chunks_worker.py`

## External Verification

- Azure AI Search Create Index
  - https://learn.microsoft.com/en-us/azure/search/search-how-to-create-search-index
- Azure AI Search Add Scoring Profiles
  - https://learn.microsoft.com/en-us/azure/search/index-add-scoring-profiles
- Qdrant Payload
  - https://qdrant.tech/documentation/concepts/payload/
- Qdrant Filtering
  - https://qdrant.tech/documentation/concepts/filtering/
- Qdrant Multitenancy
  - https://qdrant.tech/documentation/guides/multitenancy/

## Findings

### 1. repo 已经具备双 lane 的 core worker + CLI worker + targeted tests

- `institutional_rules` 已有：
  - core prep function
  - CLI worker
  - core unit tests
  - worker CLI tests
- `scoped_rules` 也已具备同级结构。
- 因此 `Phase 6` 的正确问题不是“要不要新增 institutional lane”，而是把它正式定义成与 `scoped_rules` 同级的 repo-native acceptance seam。

### 2. parity 的对象是 operator seam 与 artifact contract，不是把两条 lane 强行做成同一套校验计数

- 两条 lane 已经共享：
  - `documents.json`
  - `object-store-root`
  - `output-dir`
  - optional `--document-id`
  - `chunk-prep-manifest.json`
  - `validation-summary.json`
  - `document-reports.jsonl`
- 但它们保留不同的 fail-close truth：
  - `institutional_rules`
    - identity metadata
    - semantic-owner lineage
  - `scoped_rules`
    - projection metadata
    - `cycle_year`
    - `school_unit_name`
- 所以 parity 应冻结为：
  - shared operator contract
  - shared artifact shape
  - collection-specific validation counters

### 3. `institutional_rules` 的 owner-lineage 检查是 acceptance truth，不是 parity 异常

- `docs/reference/institutional-regulations-promotion-quality-acceptance.md` 已明确要求：
  - `source_notice_document_id`
  - `semantic_owner_document_id`
  在 attachment-backed target 中必须显式分离。
- `internal_notice_institutional_regulation_chunk_prep.py` 也已把这点实现成 fail-close 校验。
- 因此 `Phase 6` 不应为了“和 scoped_rules 看起来一致”去抹平这类 regulation-only identity truth。

### 4. 官方资料支持继续把显式 metadata 当成一等 contract，而不是把它们延后到 release/index 阶段

- Azure AI Search 官方文档要求 schema 中显式标记可过滤字段；filterable 字段与 searchable 字段语义不同。
- Qdrant 官方文档把 payload 描述为 point 的一等 metadata，并明确支持基于 payload 的 filter 条件。
- 基于这些资料的推断是：
  - `cycle_year`
  - `school_unit_name`
  - `document_nature`
  - `source_notice_ids`
  - `semantic_owner_document_id`
  这类字段必须在 `offline_preparation` 阶段就稳定保留，不能等到 future query-serving reopen 再回填。

### 5. 官方资料也支持把 freshness 留在 ranking/filter 语义，而不是回写成 collection membership truth

- Azure AI Search 官方 scoring profile 文档把 freshness 视为 ranking signal，而不是 document validity truth。
- 基于该文档的推断是：
  - `source_notice_release_time`
  - year / temporal hints
  应继续保留为 metadata / future query policy input，
  但不能反向改写当前 `institutional_rules` 与 `scoped_rules` 的 collection membership。

### 6. 当前正确 stop point 仍是 isolated local snapshot 下的 `offline_preparation`

- runbook 已明确：
  - 输入是 target snapshot registry rows + derived `document-units.jsonl`
  - 输出是 local-only acceptance artifacts
- 因此 `Phase 6` 只应收口：
  - target snapshot
  - chunk-prep artifact
  - validation summary
- 不应顺势推进：
  - embedding
  - Qdrant write
  - release
  - alias publish

### 7. 先完成 parity，再做 11-target rerun，顺序是对的

- 当前 repo 已经明确 `Phase 7` 要对现有 `11` 条 admitted target 做 full rerun。
- 如果先不把 `institutional_rules` lane 的 parity seam 写清，后续 rerun 的失败会混成：
  - acceptance 真失败
  - operator path 不一致
  - artifact contract 不一致
- 所以 `Phase 6` 作为 `Phase 7` 的前置 slice 是合理且必要的。

## Phase-6 Decisions To Freeze

1. `institutional_rules` 与 `scoped_rules` 的 parity 基线是 shared operator/artifact seam，不是 identical validation counters。
2. `institutional_rules` 的 identity / lineage fail-close 检查继续保持 collection-specific truth。
3. `documents.json + object-store-root + output-dir + artifact triplet` 固定是双 lane 的 shared operator seam。
4. `cycle_year`、`school_unit_name`、`document_nature`、`source_notice_ids`、`semantic_owner_document_id` 等 metadata 继续在 `offline_preparation` 阶段显式保留。
5. `source_notice_release_time` 等时间字段继续只作为 metadata / future ranking or filter input，不回写当前 collection membership truth。
6. `Phase 6` 只收口 repo-native parity、tests、runbook/reference continuity，不 reopen source replay、promotion 或 publish。

## Deferrals

- `Phase 7`
  - 11-target full rerun
  - fail-close gap closure
- `Phase 8`
  - evidence freeze
  - workstream closeout
- future reopen
  - query-serving
  - embedding / indexing
  - release / alias publish

## Risks If Mis-Scoped

- 如果把 parity 理解成“所有 counters 都做成一样”，会错误抹平 regulation-only lineage truth。
- 如果把 metadata 留到 release/index 阶段再补，`Phase 7` rerun 会失去明确的 fail-close依据。
- 如果把 `source_notice_release_time` 直接拿来重写 collection membership，会重新污染 ADR-0036 / ADR-0037 已冻结的 target 边界。
- 如果 `Phase 6` 继续扩到 embedding 或 publish，这条 workstream 会越过当前授权 stop point。

## Conclusions For Phase 6

1. 这一步的核心是把已存在的 dual-lane chunk-prep 实现收口成稳定的 repo-native parity seam。
2. parity 关注 shared operator/artifact contract，同时保留 collection-specific fail-close truth。
3. 官方资料支持继续把 explicit metadata 留在当前阶段，而不是等 query-serving reopen 再补。
4. `Phase 6` 完成后，`Phase 7` 才适合做 11-target acceptance rerun。
