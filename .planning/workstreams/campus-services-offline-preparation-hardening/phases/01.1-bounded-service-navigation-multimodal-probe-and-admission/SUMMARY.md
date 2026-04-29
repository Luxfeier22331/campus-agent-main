---
phase: "01.1"
artifact: "summary"
created: 2026-04-20
updated: 2026-04-20
status: completed
---

# Phase 01.1 Summary

## Outcome

`admitted as bounded production materialization candidate`

这次 execution 结论不是 repo-wide admission，也不是 source-truth lane 变更。
它只说明：

- handbook-derived `中央民族大学学生公寓管理工作流程`
- 在 `source_page_start=252` 到 `source_page_end=255`
- 这一条 `service_navigation_document`

可以把多模态提升为 `Phase 2` 的受限 hybrid materialization candidate。

## What Was Executed

- 使用 repo root `.env` 中已配置的 prompt runtime provider/model
- 使用同一组页图：
  - `.tmp/campus-services-handbook-slice/multimodal-probe/page-01.png`
  - `.tmp/campus-services-handbook-slice/multimodal-probe/page-02.png`
  - `.tmp/campus-services-handbook-slice/multimodal-probe/page-03.png`
  - `.tmp/campus-services-handbook-slice/multimodal-probe/page-04.png`
- 使用同一条受边界约束的 extraction prompt
- 使用同一套 strict JSON schema
- 连续运行 3 次 `Responses API` 多图 probe

执行 artifacts:

- `.tmp/campus-services-handbook-slice/multimodal-admission/run-01-response.json`
- `.tmp/campus-services-handbook-slice/multimodal-admission/run-02-response.json`
- `.tmp/campus-services-handbook-slice/multimodal-admission/run-03-response.json`
- `.tmp/campus-services-handbook-slice/multimodal-admission/run-01-normalized.json`
- `.tmp/campus-services-handbook-slice/multimodal-admission/run-02-normalized.json`
- `.tmp/campus-services-handbook-slice/multimodal-admission/run-03-normalized.json`
- `.tmp/campus-services-handbook-slice/multimodal-admission/admission-summary.json`

## Stability Result

### Stable Findings

- 3 次运行都只返回 `252-255` 页，没有越界。
- 3 次运行的流程数量一致：
  - page 252: `0`
  - page 253: `2`
  - page 254: `2`
  - page 255: `2`
- 3 次运行的步骤数量一致：
  - page 253: `6 + 6`
  - page 254: `5 + 3`
  - page 255: `5 + 5`
- `next_step_ids` 结构稳定，没有悬空引用或页外引用。
- 输出比当前 OCR-only 结果显著更接近可消费的 step graph，而不是 title-only / image-reference-heavy 文本。

### Observed Drift

- `run-01` 与 `run-02` 的 normalized outputs 完全一致。
- `run-03` 与前两次的唯一差异，是为 page 253 第二条流程的第 4 步补了一条局部 `manual_review_notes`：
  - “步骤4框内首行包含圈号‘①’‘②’，版面较密，但整体文字可辨。”

这个 drift 不影响：

- 流程标题
- 步骤数
- step ordering
- edge graph
- page scope

因此它属于局部人工复核提示，而不是结构性不稳定。

## Why The Outcome Is Not `bounded probe only`

按 `PLAN.md` 的 rubric，这次已经满足 `bounded production materialization candidate` 的最低条件：

- page 253-255 的 step graph 在重复运行中稳定
- 不确定点只出现在局部备注，而不是主流程结构
- 没有出现页范围外的新实体或制度解释性补写
- 结果明显优于当前 OCR 双跑的正文恢复能力

## Frozen Consequence For Phase 2

`Phase 2` 不再保持 OCR-only。

它应冻结为：

- `OCR provenance + constrained multimodal flowchart body extraction`

固定规则：

- OCR provider response 继续保留为 provenance
- 多模态只用于这条 bounded slice 的 flowchart body / edge recovery
- 不改写 repo-wide PDF / image canonical routing
- 不打开 query-serving
- 不扩到 curriculum、auth、regulation 或其他 handbook projections

## Commands Run

- `bash -lc 'set -a; source .env >/dev/null 2>&1; uv run --all-packages python - <<\"PY\" ... PY'`
  - 作用：对 4 张 page PNG 发起 3 次多图 strict-schema probe，并把 raw/parsed/normalized 结果落盘到 `.tmp/campus-services-handbook-slice/multimodal-admission/`
- `diff -u .tmp/campus-services-handbook-slice/multimodal-admission/run-01-normalized.json .tmp/campus-services-handbook-slice/multimodal-admission/run-02-normalized.json`
  - 结果：无差异
- `diff -u .tmp/campus-services-handbook-slice/multimodal-admission/run-01-normalized.json .tmp/campus-services-handbook-slice/multimodal-admission/run-03-normalized.json`
  - 结果：只有 1 条局部 `manual_review_notes` 差异

## Closeout

`Phase 01.1` 已完成。

下一步不是继续争论 admission，而是：

- 把 `Phase 2` 规划为 bounded hybrid materialization
- 明确保留 OCR provenance、接入受限多模态 body/edge recovery、并把 fail-close gate 写入实现与验证
