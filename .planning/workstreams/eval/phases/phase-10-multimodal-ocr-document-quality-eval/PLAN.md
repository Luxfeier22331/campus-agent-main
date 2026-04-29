---
doc_type: phase_plan
phase: "10"
phase_name: "Multimodal / OCR / Document Quality Eval"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 10 Plan: Multimodal / OCR / Document Quality Eval

## Objective

为 notice 图片正文、OCR/MinerU、表格抽取、视觉理解与 document canonicalization
建立可重复质量 eval。

## Entry Conditions

- notice / document ingestion pipeline 已有稳定 source truth、derived artifact 与
  read-model projection。
- multimodal processing policy 与 routing taxonomy 已由 notice/data-plane owner 固定。
- 不含 restricted 原图的 synthetic/desensitized visual fixtures 可 repo-track。

## Scope

- 建立 action fixture 与 visual-understanding fixture。
- 验证 OCR/MinerU 文本完整性、表格结构、required span、forbidden claim、
  confidence 与 reason code。
- 验证 multimodal result 只能进入 allowed projection/read-model truth，不冒充
  regulation-ready owner text。
- 为 image-heavy notice / attachment / scanned document 建最小 smoke 与
  regression suite。

## Non-Goals

- 不把 restricted notice 原图上传到 hosted eval 平台。
- 不把视觉模型摘要直接当 canonical regulation truth。
- 不追求 repo-wide 全量视觉理解 benchmark。

## Exit Criteria

- multimodal/OCR eval fixture repo-tracked 且可本地运行。
- gate 能发现 title-only、表格丢失、关键字段缺失、低置信误采纳与 forbidden claim。
- eval artifact 只保存 sanitized expected/output summary 与 safe evidence links。
