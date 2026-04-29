---
phase: "01.1"
name: "Bounded Service Navigation Multimodal Probe And Admission"
created: 2026-04-20
updated: 2026-04-20
status: pending
---

# Phase 01.1 Context

## Goal

对 handbook-derived `中央民族大学学生公寓管理工作流程` 执行一次严格受边界约束的多模态 probe，
判断它是否值得被 admission 为 `service_navigation_document` 的正式 target-side materialization lane。

## Current Truth

- `Phase 01` 已冻结 selector、artifact boundary 与 fail-close 口径。
- 当前真实 OCR 对比已经完成：
  - `Paddle` 与 `MinerU` 都能拿到标题，但都没有把流程图内部步骤稳定恢复成可直接消费的正文。
  - compare 结果为 `manual_review`，不是明确赢家。
- 对同一页段的本地高分辨率页图 probe 显示：
  - page 254、255 的节点文本与主箭头关系可读性较高
  - page 253 也能恢复大部分步骤，但局部回折箭头仍需人工复核
- 当前 repo accepted truth 仍是：
  - 多模态 lane 只允许作为 bounded probe / enrichment 候选
  - 不得直接替代 document-image OCR / layout parser canonical lane

## Why This Inserted Phase Exists

如果跳过这一 phase，直接进入当前 `Phase 2`，就会默认：

- 问题仍然只是 OCR provider 或 OCR materialization 细节问题
- `bounded OCR materialization` 本身足以收口这条流程图

但最新证据已经说明：

- 这 4 页流程图的真正问题是“框内步骤和连线结构未被 OCR 主链路稳定恢复”
- 多模态 probe 已经显示出比 OCR 更高的正文恢复潜力
- 因此必须先做 admission 判断，再决定 `Phase 2` 应继续保持 OCR-only，还是升级成 “bounded OCR + constrained multimodal extraction” 的 target-side lane

## Guardrails

- 只处理 `source_page_start=252` 到 `source_page_end=255`
- 不把多模态 lane 扩成 repo-wide 通用图片理解平台
- 不把多模态结果直接写成 source-truth
- 不打开 `service_catalog` query-serving
- 不碰 curriculum 课程地图、auth、regulation downstream

## Canonical References

- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01-service-navigation-projection-contract-freeze/PLAN.md`
- `.tmp/campus-services-handbook-slice/compare/paddle/summary.json`
- `.tmp/campus-services-handbook-slice/compare/mineru/summary.json`
- `.tmp/campus-services-handbook-slice/compare/mineru/comparison.json`
- `.tmp/campus-services-handbook-slice/multimodal-probe/page-02.png`
- `.tmp/campus-services-handbook-slice/multimodal-probe/page-03.png`
- `.tmp/campus-services-handbook-slice/multimodal-probe/page-04.png`

## Expected Output

- 明确判定：
  - `not admitted`
  - `admitted only as bounded probe`
  - `admitted as bounded production materialization candidate`
- 如果 admitted，冻结：
  - 允许输出的 constrained schema
  - 稳定性 gate
  - 与现有 OCR artifact contract 的衔接方式
