---
doc_type: decision
decision_id: ADR-0031
status: accepted
created: 2026-04-08
updated: 2026-04-09
---

# ADR-0031 Authenticated Notice Attachment Typed Routing And Spatial Review Boundary

## 状态

Accepted on 2026-04-08.

## 背景

`authenticated_notice_portal -> campus_notices/internal_notice` 这条链路已经明确暴露出一个长期边界问题：

- notice 正文整体较干净，主要噪声集中在 attachments
- 同一条 notice 往往混有多种附件形态，而不是单一类型
- 图片附件里同时存在“线性文本/表格主导”的内容与“空间关系主导”的内容
- 如果只按 notice 整体分类，最终只能在两种错误之间摇摆：
  - 为了导览图把整条 notice 全局降级
  - 为了保吞吐把空间图错误送入 OCR lane

真实样本已经证明这种混合形态是常态，而不是少数异常：

- 同一条 notice 可以同时包含办公室名单图、服务时间表、校园导览图、位置示意图
- 这类混合样本里，真正需要 OCR 的只是其中一部分 attachment

与此同时，当前主流 OCR / document parsing 能力的强项仍然是：

- 文本块、段落、标题、表格、图表、公式等结构化提取
- layout-aware parsing 与 markdown / structured output

它们并不天然等价于：

- 校园导览图、楼宇分区图、位置示意图这类空间关系主导视觉资产的 canonical understanding

如果这个边界不冻结，后续实现很容易退化为：

- 把 notice 级标签误当成 attachment 执行路由
- 把空间图伪装成 OCR candidate
- 把 attachment 噪声反向传播为 parent notice 的全局 chunk 策略
- 在 `manual_review_required`、`unsupported_binary`、`no_extractable_text` 上做静默 fallback

## 决策

### 决策 1：执行分流的主单位固定为 attachment，而不是整条 notice

长期上，`internal_notice` 的 typed routing 主单位固定为：

- attachment / inline image

而不是：

- 整条 notice

直接含义：

- notice 级标签可以存在，但只作为 risk labeling / pilot sampling / operator triage 使用
- 任何进入 extraction lane 的硬决策，都必须在 attachment 级完成
- 不允许用 `body_with_spatial_attachments` 之类的 notice 标签直接替代 attachment routing

### 决策 2：notice body 与 attachments 固定分开治理

长期上，`internal_notice` 的 document build / cleanup / chunk preparation 固定分成两层：

- parent notice body lane
- attachment child-document / terminal-outcome lane

直接含义：

- parent notice 只消费正文结构单元
- attachment refs 继续留在 source-truth relation truth
- attachments 如需进入 document/chunk pipeline，必须先 materialize 为 repo-owned child documents
- attachment 的噪声、失败和例外，不得反向驱动 parent notice body 的全局策略

### 决策 3：attachment typed routing 固定采用五类终态

长期上，authenticated notice attachment 固定只允许以下 typed routing 结果：

- `reference_only`
- `text_extractable`
- `ocr_required`
- `manual_review_required`
- `unsupported_binary`

补充要求：

- `ocr_required` lane 内部仍允许产生 `materialized_document` 或 `no_extractable_text`
- `manual_review_required`、`reference_only`、`no_extractable_text` 都属于显式 terminal outcome
- 不允许把 terminal outcome 伪装成“成功进入可检索 child document”

### 决策 4：空间关系主导图片固定进入 `manual_review_required`

长期上，以下 attachment 类型不进入当前 generic OCR lane：

- 校园导览总图
- 位置示意图
- 楼宇分区图
- 其他主要价值在空间关系而不是线性正文的 visual asset

这类 attachment 固定进入：

- `manual_review_required`

直接含义：

- 它们不是 `reference_only decorative asset`
- 它们仍然是 notice 的信息组成部分
- 当前 canonical 形态固定为“保留 relation truth + 显式 manual outcome + `review_reason`”
- 如后续需要自动处理这类内容，应新增独立 `spatial/manual` lane，而不是回退到 generic OCR

### 决策 5：OCR lane 只覆盖文本与表格主导的图片

长期上，`ocr_required` 的 canonical 输入只覆盖：

- 线性文本主导图片
- 表格主导图片
- 电话、营业时间、联系方式、办公名单这类文字型信息图

明确不包括：

- 主要价值来自空间布局、位置关系、路径指示的图片
- 正文已经给出 canonical 说明、图片只承担辅助展示作用的二维码、示例证书、宣传海报、冗余教程截图

原因：

- 当前 OCR / layout parsing 的长期价值在文本结构化提取
- 即使能从空间图中抽出零散文字，也不等于得到了可检索、可回答的空间真相
- 对辅助展示图片继续做 OCR，只会把 attachment 噪声放大成 replay blocker 或低价值 child document

### 决策 6：notice 级分类只作为辅助标签，不得替代执行路由

长期上，允许对 notice 增加辅助 risk label，例如：

- `body_only`
- `body_with_reference_only_attachments`
- `body_with_text_attachments`
- `body_with_spatial_attachments`
- `mixed_high_risk`

但这些标签的职责固定为：

- pilot 样本覆盖
- 人工验收预算
- operator triage / progress reporting

它们不拥有：

- attachment extraction lane 的最终决定权

当前 Phase 1 的 repo 内落地形态固定为：

- 这些标签是 inventory / replay / closeout read model 的派生字段
- 它们由 attachment composition 派生，不回写 source-truth contract
- 后续如需引入 title / `notice_type_names` / 正文关键词等更强 notice-level heuristics，也只能增强 risk labeling，不能替代 attachment routing

### 决策 7：禁止静默 fallback 与全局劣化

长期上，authenticated notice attachment routing 固定禁止：

- 把 `manual_review_required` 偷偷继续送入 OCR
- 把 `unsupported_binary` 伪装成 `reference_only`
- 把 `no_extractable_text` 伪装成成功 materialized child document
- 因个别 attachment 脏表格、导览图或 OCR 噪声，全局缩小 parent notice body 的 chunk 策略

这条规则的目标是：

- 先保住 parent notice body 质量
- 再把 attachment 风险显式局部化

## 结果

直接结果如下：

- `authenticated_notice_portal` 的 typed routing 需要先做 attachment inventory，再做 extraction lane 决策
- `internal_notice` 的 notice-level classification 只作为辅助 read model，不是主执行模型
- 空间关系主导图片继续留在 relation truth + manual outcome，不进入当前 chunk / retrieval truth
- 后续如果要支持校园导览图、位置图的自动理解，应沿 `navigation-specialist` / spatial truth 方向另开能力，而不是继续加大 OCR lane

## Related Docs

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-pilot-runbook.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
