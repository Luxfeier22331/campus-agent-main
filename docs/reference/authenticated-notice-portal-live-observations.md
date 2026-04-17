---
doc_type: reference
status: historical
created: 2026-04-09
updated: 2026-04-12
---

# Authenticated Notice Portal Live Observation Snapshot

## 文档边界

本文只保留 `2026-04-09` 对 `authenticated_notice_portal` 的一轮 live 登录态观察快照。

本文回答的是：

- live portal 登录态当时留下了哪些关键 contract 结论
- portal `notice_type` 为什么只能作为 coarse prior
- live attachment truth 对 donor intake / routing baseline 提供了哪些校正

本文不负责：

- 充当当前 active collector runbook
- 充当当前 notice-family truth
- 长期维护逐页 sample、下载路径和批次报告

当前应优先阅读：

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json`

## Historical Contract Findings

这轮 live 观察留下的三条核心历史结论是：

1. 登录态 contract
   - `SSO_TGC` 是最关键的长期登录输入
   - `JSESSIONID` 是 portal 页面访问后可重新派生的 runtime session，不应被当作必须人工维护的核心字段
2. taxonomy contract
   - repo-local collector 当时默认只启用 `5 / 办公通知`
   - 这只是 bounded live execution policy，不是 source-channel scope truth
   - `办公通知`、`教学通知`、`科研通知`、`学工通知` 都只能提供 coarse prior，不能直接当作 notice-family truth
3. attachment contract
   - `notice_info.notice_annext` 才是 policy / handbook wrapper notice 的真实附件来源
   - 仅靠 `notice_content` 里的 HTML `<a>` 会漏掉关键附件

## Historical Attachment Findings

这轮 live detail 校验固定确认了三条高价值样本：

- `355282`
  - 附件：`.docx`
  - 目标 lane：`text_extractable`
- `351704`
  - 附件：`.pdf`
  - 目标 lane：`ocr_required`
- `351699`
  - 附件：`.pdf`
  - 目标 lane：`ocr_required`

其中 `351704` 与 `351699` 的 live PDF 字节内容相同，因此当时固定收口出两条规则：

- policy / handbook `pdf` 的 canonical 主链路应为 cloud async OCR
- 重复 PDF 应按内容 hash 去重，避免重复 OCR

## Historical PDF Morphology Conclusion

当时对 `policy_regulation` 的 bounded expansion 继续确认了：

- broad sample 虽然 attachment-heavy，但并不是 PDF-heavy
- 当前 live/recent scope 下的 PDF morphology 样本基本已接近自然上限
- 若还要继续扩大 PDF morphology 样本，应切换新的 bounded source boundary，而不是重复当前 donor tail 与当前 live page window

## Historical Significance

这份 snapshot 的历史意义是：

- 首次把 portal live auth、taxonomy 和 attachment contract 分开落盘
- 首次明确 `notice_type` 只能作为 coarse prior，不能替代 family rule
- 首次用 live attachment truth 校正了 donor bundle `attachments=[]` 不等于“portal 无附件”这件事

## Historical Verdict

当时可以成立的结论是：

- live 登录态的 canonical operator 输入应优先理解为 `SSO_TGC`
- portal `notice_type` 不能直接决定 notice-family admission
- donor bundle 的 attachment 缺失必须和 live detail truth 分开判断
- live 校正不应阻塞 historical donor absorption，它的价值主要在于校正 contract 与 routing baseline
