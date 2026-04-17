# Quick Task 260411-mbr Summary

## Outcome

- 已完成 `中央民族大学采购工作管理办法` 的 `internal_notice` 单文档 local-only chunk-prep pilot。
- pilot 直接复用了 `internal_notice_chunking_validation` 的现有 scan/report/sample-export seam，没有引入新的 chunking 路径。
- 当前结果是 `ready_for_chunk_prep`，且没有读写失败、没有 fragmentation、没有 markup leakage、没有 title/context 缺失。

## Actual Pilot Result

- 文档标题：`关于修订《中央民族大学采购工作管理办法》的通知`
- notice id：`187233`
- lane：`notice_body`
- `validated_document_count = 1`
- `total_units = 22`
- `total_chunks = 7`
- `notice_risk_label = body_only`
- `issue_flags = []`

## Important Finding

这次 pilot 证明的是：

- `internal_notice` 当前 `notice_body` lane 可以把这份制度型通知稳定切成可消费 chunk

这次 pilot 没有证明的是：

- 它已经可以直接写入 `regulations/institutional_regulations`

原因是 chunk preview 里仍能看到明显 wrapper 语义：

- chunk 2 仍保留 `学校各单位、各部门`、`现将有关事项通知如下`
- chunk 7 仍保留 `特此通知`、`附件：采购意向公开参考文本`、署名日期

因此，当前前向结论应是：

- `internal_notice` 可以继续推进
- 但下一步应是 `notice_body -> regulation_body` 的 promotion-side cleanup / projection，而不是直接做 regulation collection write

## Local-Only Boundary

- 没有 Postgres 写入
- 没有 Qdrant
- 没有 embeddings
- 没有 release manifest
- 没有 alias publish
- 没有 promotion target collection write

## Artifacts

- `pilot_187233_local_chunk_prep.py`
- `187233-pilot-summary.json`
- `187233-chunk-catalog.json`
- `187233-chunk-preview.md`
- `187233-sample-export/`

## Next Step

当前最合理的下一步不是扩大样本，也不是做 promotion write，而是：

- 为 `中央民族大学采购工作管理办法` 增加 promotion-side body cleanup / wrapper stripping 规则；
- 在不改变 `internal_notice` source-triage 身份的前提下，生成更接近 canonical regulation text 的候选正文。
