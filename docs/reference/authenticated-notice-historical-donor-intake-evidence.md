---
doc_type: reference
status: historical
created: 2026-04-09
updated: 2026-04-12
---

# Authenticated Notice Historical Donor Intake Snapshot

## 文档边界

本文只保留 `rag-data` historical donor 吸纳到 repo-owned `authenticated_notice_portal` intake seam 的历史 acceptance 快照。

本文回答的是：

- 哪三批 donor intake 样本当时被接受
- normalization / local smoke 当时闭合到了什么程度
- attachment routing 与 policy/wrapper 分流当时留下了哪些长期有效结论

本文不负责：

- 充当当前 `internal_notice` current-scope truth
- 充当 replay / preparation / release 的 active 入口
- 长期维护每轮 `.tmp` artifact 细节

当前应优先阅读：

- `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`

## Historical Accepted Batches

当时接受了三批 donor intake：

1. `run14-policy-regulation-core-v1`
   - `9` 条 `policy_regulation` core 样本
   - 作用：证明 parent-only governance / regulation notice 可以进入 repo-owned source-truth intake
2. `run14-attachment-routing-probe-v1`
   - `4` 条 attachment routing probe 样本
   - 作用：验证 `text_extractable` / `manual_review_required` / `reference_only` 的 donor baseline
3. `run14-policy-regulation-expanded-v1`
   - `16` 条扩大的 `policy_regulation` broad sample
   - 作用：为后续把 policy body 与 wrapper notice 分开处理提供更大分母

## Historical Verification Snapshot

当时的基础验证固定为：

- targeted tests：`17` 个测试通过
- Batch 1 normalization：`6694 -> 9`
- Batch 1 local smoke：`notice_count = 9`、`created_document_ids = 9`、`raw_uploaded_count = 9`
- Batch 2 normalization：`6694 -> 4`
- Batch 2 local smoke：`notice_count = 4`、`created_document_ids = 4`、`attachment_ref_total = 7`
- Batch 3 normalization：`6694 -> 16`
- Batch 3 local smoke：`notice_count = 16`、`created_document_ids = 16`、`raw_uploaded_count = 16`

这批历史结果说明：

- `legacy donor export -> normalized bundle -> local bootstrap smoke` 这条 intake seam 当时已经 repo-tracked
- 三批样本都能稳定进入 source-truth import / local smoke

## Historical Routing And Scope Conclusions

这轮 donor intake 后留下的长期有效历史结论主要有三条：

1. attachment routing
   - Batch 2 的 accepted totals 固定为：
     - `text_extractable = 1`
     - `reference_only = 1`
     - `manual_review_required = 5`
     - `ocr_required = 0`
   - 二维码样本应落 `reference_only`
   - 操作指引类 inline image 应落 `manual_review_required`
2. policy body 与 wrapper notice 必须分开
   - parent-only policy notice 可以直接进入第一批制度正文 baseline
   - 已确认或高度怀疑存在 canonical 附件的 wrapper notice，不应直接冒充最终制度正文
3. duplicate notice identity 应保留
   - `351704 / 351699`
   - `191177 / 191176`
   - intake 单位仍是稳定 `notice` 资源，而不是“看起来相同正文”的投机性去重

## Historical Significance

这份 snapshot 的历史意义是：

- donor intake seam 首次被 repo-owned normalization + local smoke 收口
- attachment routing 的早期 acceptance baseline 首次被明确记录
- `policy body`、`wrapper notice`、`duplicate notice identity` 这三类边界首次被显式写清

## Historical Verdict

当时可以成立的结论只有：

- 三批 historical donor intake 样本都已被接受
- donor normalization/import seam 已 repo-tracked
- 第二批 routing probe 可以作为 attachment routing baseline
- 第三批 expanded sample 可以作为更大范围的 `policy_regulation` 历史基线

当时不能成立的结论仍然包括：

- `internal_notice current scope accepted`
- `authenticated notice replay accepted`
- `chunk preparation accepted`
- `embedding / Qdrant release ready`
