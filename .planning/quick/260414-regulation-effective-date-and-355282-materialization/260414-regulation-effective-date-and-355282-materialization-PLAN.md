# Quick Task 260414-regulation-effective-date-and-355282-materialization Plan

**Description:** 收口 regulation lane 的 effective_date 语义，并对 `355282` 做隔离 materialization 验证  
**Mode:** quick-full-research

## Scope

- 只处理 `regulations/institutional_regulations` promotion/materialization 语义
- 只验证 `355282`
- 只在隔离 object store + in-memory registry 中 materialize

## Success Criteria

1. `effective_date` 不再作为 promotion required metadata。
2. `355282` 能在隔离环境中 materialize 到 regulation target。
3. materialized target 保持：
   - `semantic_owner_kind=attachment_document`
   - `source_notice_release_time` 保留
   - `effective_date=null`

## Non-Goals

- no formal current-scope replace
- no chunk prep
- no embedding / Qdrant
- no release / alias publish
