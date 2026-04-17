# Quick Task 260414-bsz Plan

**Description:** 修复 `355282` 的 source projection 缺口并将其正式并入 local regulation target  
**Mode:** quick-full

## Scope

- 只处理 `355282`
- 只写：
  - source-truth repair
  - targeted source projection rebuild
  - filtered promotion/materialization summary
  - docs / planning truth
- 不处理：
  - 其他 notice
  - chunk prep
  - embedding / Qdrant / release / alias

## Success Criteria

1. local source scope 中 `355282` 同时存在 parent row 与 attachment child row。
2. filtered promotion 对 accepted notice set + `355282` 的结果为：
   - `candidate_count = 11`
   - `manual_review_count = 0`
3. `regulations/institutional_regulations` local current target count 变为 `11`。
4. `355282` 的 target document 为：
   - `institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`
   - `title = 中央民族大学关于学生使用人工智能的指导意见 / 2026版`
