# Quick Task 260419-anr Plan

**Description:** authenticated-notice regulation consumption Phase F legacy Office / metadata truth planning  
**Mode:** quick-full

## Scope

- 只规划 non-auth `authenticated-notice -> regulation downstream consumption` 的 Phase F
- 只覆盖：
  - `xls/xlsx` supported truth 文档纠偏
  - `.doc` normalization contract
  - worker-owned provenance / normalization 入口
  - inventory-friendly fail-close 语义裁决
- 不覆盖：
  - auth-window `file_release` owner recovery
  - source-wide replay
  - query-serving reopen
  - embedding / Qdrant / release / alias

## Success Criteria

1. repo 对 `docx/xls/xlsx/.doc` 的 current truth 有一致说法，不再出现“代码支持但计划文档仍写成未支持”。
2. `.doc` 的前向支持路径被冻结为 worker-owned normalization contract，而不是自写 parser 或临时人工转换。
3. promotion/materialization 保持 file-type agnostic，legacy Office 变化只发生在 source projection / worker boundary。
4. Phase F 的实施顺序、写集和验证命令可以直接被后续执行会话接手。

## Execution Order

1. 文档真相收口
   - 更新 `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
   - 明确 `xls/xlsx` 已支持，`.doc` 仍未支持
   - 明确 Phase F 只处理 legacy Office + metadata truth

2. 冻结 normalization contract
   - 为 `.doc` 定义 canonical 输入/输出：
     - input: original `.doc` object bytes + original mime/ext metadata
     - output: normalized `.docx` or normalized markdown/text artifact
     - provenance: original extension, normalizer name/version, normalized object key, normalized content hash
   - 长期 truth 仍写入 `S3-compatible object storage`
   - 不把本地临时目录提升成 truth

3. worker-owned normalizer 设计
   - 在 `apps/ingestion-worker` 增加 canonical normalization entry
   - 默认实现优先 `LibreOffice --convert-to`
   - 把环境前置写清楚：
     - worker runtime 是否有 `soffice`
     - 无 `soffice` 时继续 fail-close
   - 只允许 source projection 调用 normalizer，不让 promotion/materialization 直接碰 `.doc`

4. fail-close / inventory 语义裁决
   - 评估是否把当前 `.doc` replay exception 落成显式 terminal outcome
   - 如果落，要求：
     - 可盘点
     - 可重放
     - 不引入双路径
   - 如果不落，至少在 docs/runbook 中明确这是 intentional fail-close

5. 验证与回归
   - 最低验证：
     - `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections`
     - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_scoped_rule_materialization`
   - 若改动触及 import/materialization contract，再补：
     - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_materialization`
     - `uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_regulation_promotion`

## Proposed Write Set

- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/*legacy office normalizer entry*`
- `tests/ingestion/test_authenticated_notice_source_projections.py`
- 必要时少量补 runbook / reference docs

## Exit Rule

Phase F 完成后，repo 应该达到：

- `xls/xlsx` 是明确 supported truth
- `.doc` 要么仍是明确 fail-close，要么已通过 canonical worker normalizer 接入
- workstream 继续停在 `offline_preparation`
- 不把 legacy Office 后续误拆成独立 auth lane、todo，或 future query-serving workstream
