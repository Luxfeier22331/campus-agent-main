---
doc_type: decision
decision_id: ADR-0033
status: accepted
created: 2026-04-09
updated: 2026-04-20
---
# ADR-0033 Internal Notice PDF Cloud OCR Default

## 状态

Accepted on 2026-04-09.

## 背景

`authenticated_notice_portal -> campus_notices/internal_notice` 已经冻结了 attachment
级 typed routing 与 spatial/manual 边界，但此前没有把 `pdf` 的默认消费路径单独冻结。

这导致 repo 内部一度存在以下不稳定解释：

- `docx` 走 native extraction
- `pdf` 先尝试 native extraction，再视质量决定是否转 OCR
- `pdf` 只在“明显是图片型 PDF”时才进入 OCR

对当前 collection，这种模糊口径不可接受，原因是：

- 规章制度和手册类 notice 的核心内容经常在附件 `pdf` 中，而不是 wrapper notice 正文里
- `pdf` 即使带 text layer，也不等于其 native 抽取结果可直接作为 canonical 文本消费
- 当前云端 PaddleOCR-VL async jobs 在版面、表格和结构保留上，比本地 native PDF 路径更符合这条 collection
  的长期消费目标
- 如果不冻结默认路径，后续 operator 很容易把“本地能抽到一些字”误当成“native extraction 可通过”

2026-04-09 已确认三个 live 样本：

- `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
  - 附件为 `.docx`
- `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
  - 附件为 `.pdf`
- `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
  - 附件为 `.pdf`

其中：

- `351704` 与 `351699` 的 live PDF 字节内容相同，`sha256 =
  f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc`
- 这说明至少在 policy / handbook 样本里，`pdf` 既是核心内容载体，又可能跨 notice 重复出现

## 决策

### 决策 1：`pdf` 在 `internal_notice` 中默认进入 `ocr_required`

对 `campus_notices/internal_notice`：

- `pdf` attachment 的默认 canonical 消费路径固定为云端异步 OCR
- 不再采用“先 native PDF extraction，再决定是否转 OCR”的默认主链路

这里的“默认”是指：

- policy / regulation / handbook / procedure 等文档型 PDF，默认作为 `ocr_required` 处理
- 是否继续保留 `manual_review_required`，仍由 attachment 内容类型决定；空间关系主导图片不受本 ADR 改写

### 决策 2：`docx` 继续默认进入 `text_extractable`

对当前 collection：

- `docx` 继续作为 `text_extractable` 的默认稳定输入
- `docx` 仍走确定性的 native extraction

### 决策 3：native PDF extraction 只允许作为 diagnostics / probe

native PDF extraction 仍可存在，但职责固定收窄为：

- diagnostics
- 对照实验
- quality probe

它不得承担：

- replay / preparation 的 canonical 成功路径
- “OCR 失败时的静默 fallback”
- operator 默认推荐路径

### 决策 4：PDF OCR 失败不回退 native PDF success path

如果 `pdf` 的 async OCR 失败：

- 先检查 PDF 是否本来就被错误分类
- 再检查 provider 契约是否异常

固定禁止：

- 因 async OCR 失败，就把同一 PDF 直接降级为 native extraction 成功
- 把 native PDF 文本探针结果伪装成 canonical child document truth

### 决策 5：跨 notice 重复 PDF 必须按内容 hash 去重

由于同一制度 / 手册 PDF 可能被多个 notice 引用：

- child attachment 的实际消费必须按内容 hash 去重
- OCR 提交不得按 `notice_id` 盲目重复

这条规则不改写 source-truth 的 notice identity：

- `351704` 与 `351699` 仍是两个稳定 notice source unit
- 但它们引用的同一份 PDF 不应重复做 OCR 计算

## 结果

直接结果如下：

- `text_extractable` lane 当前默认样本收窄到 `docx`
- `ocr_required` lane 当前默认样本扩到文档型 `pdf` + 文本/表格主导图片
- quality acceptance 对 `pdf` 的通过判断应基于云端 OCR 结果，而不是 native text layer
- runbook 必须明确写出：`pdf -> lane-first OCR contract（MinerU primary，Paddle
  fallback）`
- collection README / evidence 文档必须把 `355282 / 351704 / 351699` 作为固定样本记录下来

## Related Docs

- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spa
  tial-review-boundary.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
