# Quick Task 260411-lxl Research

**Task:** 评估 authenticated-notice promotion 收敛后的下一执行切片：长期规章候选、chunk-prep pilot 与 manual-review 分流
**Gathered:** 2026-04-11
**Status:** complete

## Task Boundary

本研究只回答三件事：

1. promotion manifest v5 收敛后，`internal_notice -> regulations/institutional_regulations` 的下一安全执行切片是什么；
2. 哪些样本仍应停留在 `internal_notice` 的 `hold` / `manual_review_required`；
3. OCR、chunking、manual-review 这三条前向策略，当前应如何和 repo 已冻结 truth 对齐。

本研究不做：

- Postgres 写入
- Qdrant / embedding / release / alias
- 全量 raw -> index 执行
- live portal 新采集

## Repo Current Truth

### 已冻结的 collection 边界

- `campus_notices/internal_notice` 仍是 source-channel-first triage collection，不是 formal regulation owner。
- `regulations/institutional_regulations` 只允许 canonical regulation text 进入，wrapper notice 不得直接冒充 regulation。
- promotion boundary 已由 `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md` 冻结。

### OCR / replay / chunking 当前事实

- `packages/ingestion-core/src/campus_ingestion_core/raw_ingestion.py` 当前默认 OCR provider 是 `paddleocr_async_jobs`。
- 同一文件仍保留 `paddleocr_vl_service` 模式，但 repo 当前默认 truth 已是异步 jobs。
- `configs/ingestion/campus_notices/internal_notice/chunk-profile.json` 已经按 lane 区分预算，而不是单一全局预算：
  - `notice_body = 260/320/32/48`
  - `attachment_text_extractable = 220/320/32/32`
  - `attachment_ocr_required = 180/240/24/24`
- `docs/reference/internal-notice-offline-preparation-strategy.md` 已冻结 `structure-first` + lane-local quality，而不是为附件脏样本反向全局压缩正文策略。

### promotion manifest v5 当前结论

来自 `.tmp/internal-notice-promotion-manifests/run14-policy-regulation-expanded-v5-local-smoke/`：

- `promote_candidate = 1`
- `hold_in_internal_notice = 5`
- `manual_review_required = 10`

当前唯一长期规章候选：

- `187233 / 关于修订《中央民族大学采购工作管理办法》的通知`

当前仍应留在 `internal_notice` 的 wrapper hold：

- `177880`
- `351119`
- `351699`
- `351704`
- `355282`

当前 `manual_review_required` 已经清晰分成两个子桶：

- 季节性 / 暂行 / 校区运营规则：
  - `191176`
  - `191177`
  - `191705`
- 年度 / 项目制招生实施细则：
  - `186957`
  - `186977`
  - `187004`
  - `196411`
  - `351907`
  - `353963`
  - `354006`

### 当前 candidate 的真实状态

`187233` 是 promotion candidate，但还不是“可立即写入 regulation collection”的状态。

原因：

- promotion report 仍显示缺少 `source_notice_release_time`
- 当前 evidence 只够支持“进入下一步 local-only chunk-prep pilot”
- 还不够支持跨 collection write、identity/version freeze、release/index

## External Official Practices

以下是官方资料和本项目的对应关系。

### 1. 结构化 chunking 应先尊重文档结构，再做窗口控制

官方资料：

- Azure AI Search 的 structure-aware / semantic chunking 文档明确建议先用 layout / heading / paragraph 结构切分，再用 Text Split 约束 chunk 大小，而不是只做统一窗口切分。
- 参考：<https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking>

对本项目的直接含义：

- `internal_notice` 当前 lane-based chunk profile 是对的；
- 下一步不应回退到单一 `220/320/32/32` 全局预算；
- `187233` 这类正文型制度通知，应优先沿 `notice_body` lane 做 structure-first chunk-prep pilot。

### 2. 分类 / split / human review 应是分阶段 gate，而不是一次性混判

官方资料：

- Google Cloud Document AI `Custom Splitter` 明确把 classification + logical split 作为独立阶段，并支持在置信度不足时进入 human review。
- 参考：<https://cloud.google.com/document-ai/docs/custom-splitter>

补充约束：

- Google Cloud Document AI 的 Human-in-the-Loop 功能已在 2025-01-31 retired。
- 参考：<https://cloud.google.com/document-ai/docs/hitl>

对本项目的直接含义：

- repo 现在的 `notice family -> attachment routing -> promotion manifest -> manual review` 分层方向是对的；
- 但 manual review 不应绑定某个供应商 HITL 产品，而应继续采用 repo-owned manifest / taxonomy / operator review queue；
- `191705`、`191176`、`353963` 这类样本不应因为“像制度”就直接挤进长期规章 collection。

### 3. human review 的触发条件应显式化，而不是隐式兜底

官方资料：

- AWS Textract + A2I 官方文档建议 human review 基于显式 activation conditions，例如置信度阈值、关键字段缺失、特定关键词或随机抽样。
- 参考：<https://docs.aws.amazon.com/sagemaker/latest/dg/a2i-start-human-loop.html>
- 参考：<https://docs.aws.amazon.com/sagemaker/latest/dg/a2i-json-humantasks-activationconditions-textract-example.html>

对本项目的直接含义：

- `manual_review_required` 不应是“其余都扔进去”的垃圾桶；
- 应至少按可解释 taxonomy 分成：
  - `seasonal_or_interim_operations`
  - `annual_or_program_specific_admissions`
- 后续如果真的扩 scope，再决定是否派生新 collection，而不是先污染 `regulations/institutional_regulations`。

### 4. 文档 OCR 主链路应保持异步 jobs；同步端点只适合作为单文件探针

官方资料：

- 百度 OCR 官方文档当前提供的是文档解析异步任务接口，采用“提交任务 -> 轮询状态 -> 读取结果”的 shape。
- 参考：<https://ai.baidu.com/ai-doc/OCR/7mh8u7ruk>

项目对照事实：

- `raw_ingestion.py` 当前 async client 正是这个模式；
- repo 当前默认 provider 也是 `paddleocr_async_jobs`；
- `paddleocr_vl_service` 仍可保留作单文件诊断 / layout probe，但不应再被当成 historical replay 的 canonical 主链路。

这里有一条显式推断：

- 这个结论不是说同步端点“不能用”，而是说对本项目当前的批量 replay / attachment materialization / audit trail 来说，异步任务形态和 repo 既有 contract 更一致。

## Sample Evaluation

### `187233`

`187233 / 关于修订《中央民族大学采购工作管理办法》的通知` 当前是唯一适合进入下一步 pilot 的样本：

- 正文内已包含可独立消费的制度性内容，不只是“发布通知”；
- 结构自然分成“主要修订内容 / 采购注意事项 / 子条款 / 列表项”；
- 它更像 handbook / regulation body 的浅层版本，适合先做单文档结构化 chunk-prep；
- 但 promotion metadata 还没补齐，不应直接写入 `regulations/*`。

### `177880`

`177880 / 关于印发实施《中央民族大学学生申诉管理办法》的通知` 仍应保持 hold：

- 正文只说明“办法已通过并施行”，没有承载完整制度正文；
- 它是典型 wrapper / summary notice；
- 即使 regulation title 很明确，也不应把 wrapper notice 直接提升为 regulation document。

### `191705`

`191705 / 中央民族大学丰台校区就医管理办法（暂行）` 当前继续 manual 是对的：

- 文本有“暂行”“校医院正式运营前”等强烈 interim signal；
- 它是可消费的运营规则，但不是当前长期 institution-wide regulation 的稳定候选；
- 如果未来产品要消费“校区运行规则”，应进入单独语义 owner，而不是塞进 `institutional_regulations`。

### 招生实施细则样本

`186957 / 186977 / 187004 / 196411 / 351907 / 353963 / 354006` 当前继续 manual 也是对的：

- 都带明显 `2021/2022/2026` 年度或项目制招生信号；
- 适合作为未来 `admissions_program_rules` 之类的单独消费面候选；
- 不适合进入当前长期规章 collection。

## Recommended Next Slice

当前最安全、最有信息增益、又不越过 repo 边界的下一切片是：

### Slice A: 单文档 local-only chunk-prep pilot（只做 `187233`）

目标：

- 验证 `notice_body` lane 的 structure-first chunking 在长期规章候选上是否稳定；
- 产出 chunk-level sample evidence，而不是直接推进 preparation manifest / release。

输入：

- `187233` 的 `canonical.md`
- 对应 `document-units.jsonl`
- 当前 `notice_body` lane defaults

输出应只落在 repo-local artifacts：

- 单文档 chunk draft / sample export
- machine-readable validation summary
- operator-readable acceptance note

固定禁止：

- 不写 Postgres
- 不写 Qdrant
- 不做 embeddings
- 不发 release manifest
- 不动 alias

### Slice B: 冻结 manual-review taxonomy

目标：

- 让 `manual_review_required` 从“临时停车场”变成明确的 forward backlog；
- 避免后续又把 seasonal/admissions docs 错当成长期规章。

最低要求：

- 显式区分 `seasonal_or_interim_operations`
- 显式区分 `annual_or_program_specific_admissions`
- 记录未来 collection hint，但保持当前 `action = manual_review_required`

### Slice C: 补齐 candidate promotion metadata，而不是直接 promotion write

对 `187233`，下一步需要补的是：

- `source_notice_release_time`
- 后续 regulation identity/version 所需的最小 metadata

这一步在 chunk-prep pilot 之后做，顺序不要倒过来。

## What Not To Do Yet

- 不要把 16 条 sample 直接一起推进 chunk-prep。
- 不要因为同步 layout-parsing service 可用，就把 async OCR 主链路切掉。
- 不要把 `manual_review_required` 里的招生 / 暂行 / 季节性规则写进 `regulations/institutional_regulations`。
- 不要把 wrapper notice 重新解释成 regulation body。
- 不要在 candidate metadata 仍缺失时推进 promotion write。

## Research Conclusion

结论只有一条：

- promotion manifest v5 已经把“长期规章候选”和“仍属内部通知 source-triage 的内容”分开了，当前下一步不应是批量推进，而应是只对 `187233` 做 local-only chunk-prep pilot，同时把 10 条 manual 样本冻结成可解释 taxonomy，并保持 OCR 主链路为 async jobs。

## Source Links

- Azure AI Search semantic / structure-aware chunking: <https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking>
- Google Cloud Document AI Custom Splitter: <https://cloud.google.com/document-ai/docs/custom-splitter>
- Google Cloud Document AI Human-in-the-Loop notice: <https://cloud.google.com/document-ai/docs/hitl>
- AWS A2I start human loop: <https://docs.aws.amazon.com/sagemaker/latest/dg/a2i-start-human-loop.html>
- AWS Textract activation conditions example: <https://docs.aws.amazon.com/sagemaker/latest/dg/a2i-json-humantasks-activationconditions-textract-example.html>
- 百度 OCR 文档解析异步接口: <https://ai.baidu.com/ai-doc/OCR/7mh8u7ruk>
