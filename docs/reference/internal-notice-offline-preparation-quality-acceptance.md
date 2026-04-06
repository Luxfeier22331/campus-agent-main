---
doc_type: reference
status: active
created: 2026-04-06
updated: 2026-04-06
---

# Internal Notice Offline Preparation Quality Acceptance

## 文档边界

本文冻结 `campus_notices/internal_notice` 在 `verified chunk preparation` 之前的质量验收方式。

它回答的是：

- 什么算 `internal_notice` 的离线 preparation 质量通过
- parent notice、text-extractable attachment、OCR attachment 分别要验什么
- 哪些结果只代表“结构可运行”，哪些结果才代表“可以收口这批 preparation”
- 验收时必须产出哪些 summary / sample evidence

它不替代：

- `docs/reference/internal-notice-offline-preparation-strategy.md` 的 lane strategy
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 replay / prep 操作流程
- `docs/architecture/authenticated-notice-source-architecture.md` 的 repo-level boundary

## 核心结论

对 `internal_notice`：

- `prepare_registry_scope_chunks` 通过，只代表 current scope 能完成 `document-units -> chunks` 的结构性 preparation
- 这不等于 attachment extraction、cleanup、chunk quality 已经通过
- 在显式质量验收完成之前，不允许把这批 preparation 继续送进 embedding、Qdrant 或 alias publish

因此当前 collection 的 canonical stop point 固定为：

- `verified chunk preparation`

不是：

- `chunk preparation passed`
- `可以直接继续 release`

## 验收输入

质量验收固定只消费 repo-owned truth：

- current registry scope 下的 `source-faithful` current records
- 或显式 `preparation_run_id` 对应的 frozen preparation manifest
- derived bucket 中这些 records 对应的 `document-units.jsonl`

固定禁止：

- 回退到 collector SQLite 或临时文件系统路径做质量判定
- 用 export bundle 直接替代 repo-owned `document-units.jsonl`
- 因为某份附件单独脏，就把 parent notice body 的默认策略整体缩小

## 验收产物

一次完整的 `internal_notice` 质量验收，至少要产出三类 evidence：

- machine-readable validation summary
- operator / agent 可读的 sample export
- repo-tracked acceptance note 或 run evidence

其中：

- validation summary 用来冻结 pass/fail verdict 与计数指标
- sample export 用来审查 chunk text、lane metadata、source rows 与清洗结果
- acceptance note 用来说明这次 run 的结论、已知失败类型和是否允许继续到后续阶段

如果缺少 sample evidence，就不能把“结构可跑”写成“质量已验收”。

## 当前 Validator 入口

repo 当前的只读质量验收入口固定为：

```bash
uv run --package campus-ingestion-worker python -m campus_ingestion_worker.validate_internal_notice_chunking \
  --preparation-run-id <prep_id> \
  --sample-dir <output_dir>
```

其中：

- 不传 `--preparation-run-id` 时，validator 读取 current registry scope
- 传入 `--preparation-run-id` 时，validator 读取 frozen preparation manifest 对应的 document set
- `--mode samples` 只导出样本，不产出 full validation verdict

## Lane-Specific Acceptance

### `notice_body`

`notice_body` 是默认高质量 lane，验收目标是保住正文语义完整度。

必须满足：

- 每个正文 chunk 都带稳定 `title`
- 正文 chunk 具备必要上下文，不能退化成无标题裸正文
- `attachment_ref` 不进入 parent notice chunk truth
- notice body 不因 attachment outlier 被整体切成大量碎块

必须失败的情况：

- 正文 document 为空 chunk
- chunk 丢失 `title`
- chunk 丢失必要 contextualization
- 正文出现明显过切的小碎块
- 清洗后仍残留明显 HTML / 标签泄漏

### `attachment_text_extractable`

这条 lane 的验收目标是确认 native text extraction 的结果仍保留附件本体结构，而不是被降格成 notice 正文附属片段。

必须满足：

- materialized attachment document 至少有可消费的 `attachment_body`
- chunk 保留 attachment lineage metadata，例如 `parent_document_id`、`attachment_ref_id`、`attachment_filename`
- chunk 带稳定 `title`
- 清洗后不残留明显 HTML / 标签泄漏

必须失败的情况：

- attachment document 只有标题、没有正文 chunk
- chunk 丢失 title 或 attachment lineage metadata
- 清洗后正文仍然像 raw markup / raw html
- attachment 正文被错误并回 parent notice body

### `attachment_ocr_required`

这条 lane 的验收目标不是追求和 `notice_body` 一样干净，而是证明：

- OCR lane 的噪声被局部识别和收口
- OCR 脏样本不会反向拉低 `notice_body` 的默认质量

必须满足：

- materialized OCR attachment 至少有可消费的正文 chunk
- chunk 带稳定 `title` 和 attachment lineage metadata
- OCR chunk 没有被标题 header 完全压住正文
- 明显噪声块会被 validator 标出来，而不是混在“通过”里

必须失败的情况：

- materialized OCR attachment 只有标题、没有正文 chunk
- OCR chunk 的正文极短、但 header 占比过高
- chunk 正文呈现明显噪声特征，例如清洗后仍主要是乱码、装饰符号、重复垃圾行
- 清洗后仍残留 raw html / raw markup

## Cleaning Acceptance

`internal_notice` 的清洗验收固定按 lane 区分，但下列问题一旦出现，任何 lane 都必须失败：

- replacement character 或明显乱码残留
- raw html / xml 标签直接进入最终正文
- 只有装饰符号、分隔线或重复垃圾行的 chunk 被当成有效正文

`notice_body` 与 `attachment_text_extractable` 的标准应高于 OCR lane，但 OCR lane 也不能因为“本来就脏”而放弃显式失败。

## Chunk Acceptance

chunk 级验收固定关注四类问题：

- metadata 完整性：`title`、lane、attachment lineage、source anchor
- contextualization：chunk 是否保留必要上下文
- fragmentation：是否被过切成明显小碎块
- noise isolation：OCR / 脏附件问题是否被留在 lane 内，而不是扩散到全局策略

当前 `internal_notice` 不接受“只看 token budget 不看语义质量”的验收方式。

也就是说：

- `220/320/32/32`
- `260/320/32/48`
- `180/240/24/24`

这些预算只定义 runtime budget，不单独构成质量通过证据。

## Sample Evidence Expectations

每次质量验收都必须至少抽出以下 sample bucket：

- `notice_body`: 正常正文样本
- `attachment_text_extractable`: 正常可抽文本附件样本
- `attachment_ocr_required`: 正常 OCR 附件样本
- `notice_body_fragmentation`: 正文过切或小碎块样本
- `ocr_noise_suspect`: OCR 噪声疑似样本
- `html_leak_or_markup_leak`: 清洗失败样本

sample export 至少应包含：

- document identity 与 lane
- source rows 摘要
- chunk metadata 摘要
- final chunk text

抽样的目标不是替代全量 validator，而是让 agent 能对失败类型做实际审阅和收口。

## Pass / Fail Rule

`internal_notice` preparation 只有在以下条件同时成立时才算质量通过：

- 没有 read failure / chunk failure
- 没有空 document
- 没有丢 title / 丢 lineage metadata / 丢 contextualization 的 chunk
- 没有被判定为明显过切的 notice body chunk
- 没有被判定为 header-dominant 或 noise-suspect 的 OCR chunk
- 没有 html / markup leakage
- sample evidence 已导出并完成 agent review

任一条件不满足，都只能写成：

- `preparation structurally runnable but quality not accepted`

不能写成：

- `internal_notice offline preparation completed`

## 与后续阶段的关系

当前 canonical 顺序固定为：

`source-truth replay -> document build -> split / cleanup / chunk -> quality acceptance -> explicit approval -> embedding / Qdrant / release`

在显式批准前，固定禁止：

- 调用 embedding provider
- 写入 Qdrant
- 发布 alias

## 相关稳定文档

- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `configs/ingestion/campus_notices/internal_notice/README.md`
