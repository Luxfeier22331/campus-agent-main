# Quick Task 260411-pbp Summary

## Outcome

- 已把 historical donor local-smoke routing mismatch 收口为 repo-tracked quick task，而不是继续留在 Phase 12 follow-up 列表里。
- `import_authenticated_notice_export` 现在会在真正落 source-truth / local-smoke 产物前做 preflight：
  - normalized manifest 声明 `collector.attachment_storage_mode = blob_store_reference`
  - 且选中 batch 含 object-backed attachment
  - 但请求未传 `attachment_blob_root`
  - 则直接报错，不再允许进入持久化阶段
- body-only batch 仍保持可导入；attachment-backed batch 在显式提供 `attachment_blob_root` 时仍按原 contract 成功 materialize inventory routing truth。
- repo 级 planning/runbook/reference 已同步为单一口径：local smoke inventory 是 attachment routing truth，donor byte-aware routing analysis 只保留为诊断性交叉校验。

## What Changed

- [authenticated_notice_import.py](/home/reptilian/code/campus-agent/packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_import.py)
  - import path 现在在 preflight 阶段读取 manifest + bundle，并对缺失 `attachment_blob_root` 的 attachment-backed normalized donor batch fail closed
- [test_authenticated_notice_import.py](/home/reptilian/code/campus-agent/tests/ingestion/test_authenticated_notice_import.py)
  - 新增 fast-fail test
  - 新增 body-only allowed test
- [authenticated-notice-historical-donor-intake-runbook.md](/home/reptilian/code/campus-agent/docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md)
  - 把“缺 blob root 是 execution error”写成显式 operator truth
- [authenticated-notice-historical-donor-intake-evidence.md](/home/reptilian/code/campus-agent/docs/reference/authenticated-notice-historical-donor-intake-evidence.md)
  - 补充 2026-04-11 fast-fail contract 说明
- [post-closeout-follow-up-execution-plan.md](/home/reptilian/code/campus-agent/docs/plans/post-closeout-follow-up-execution-plan.md)
  - 记录 mismatch cleanup 已完成
- [.planning/STATE.md](/home/reptilian/code/campus-agent/.planning/STATE.md)
  - 新增 quick task `260411-pbp`
  - 从 authenticated-notice remaining follow-up 中移除这条 mismatch

## External Rationale

这次收口符合官方文档支持的长期姿态：

- Databricks 的 expectations 文档明确区分 `warn / drop / fail`，其中 `FAIL UPDATE` 的语义是 invalid input 会阻止 update 成功，并要求人工干预后再处理。这支持把缺失 blob-root 依赖视为 preflight failure，而不是继续产出带歧义的 import 结果。
  - <https://docs.databricks.com/aws/en/ldp/expectations>
- Amazon S3 的 `HeadObject` 文档把“只取对象元数据而不取正文”定义为对象存在性/元数据检查的标准操作，并明确对象不存在时会返回 `404/403` 一类错误。这支持“在依赖对象字节之前先验证对象前置条件”的处理方式。
  - <https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html>

推断：

- 这些文档没有直接谈本仓库的 donor import，但它们共同支持同一条工程结论：当下游 truth 依赖外部对象字节时，正确做法是把依赖缺失收成 fail-close precondition，而不是容忍双真相。

## Boundary

- No replay rerun
- No current-scope refresh
- No release / alias changes
- No attachment-routing policy rewrite
- No donor byte-aware analysis promotion
