# Quick Task 260414-c2p Summary

**Description:** 冻结 regulation display-title 的完整版次标签格式，并补回归测试锁住 `版次/修订/暂行/届别/文号` 边界  
**Mode:** quick-full-research  
**Status:** completed

## Outcome

- regulation lane 当前 display-title 规则已明确冻结为：
  - `regulation_display_title = <work title> / <edition label>`
- `edition_label` 当前保留完整语义，不压成裸年份：
  - `中央民族大学关于学生使用人工智能的指导意见 / 2026版`
  - `中央民族大学实验室安全管理规定 / 2026年修订`
  - 当前都不是 `... / 2026`
- `暂行`、`试行`、`民大校发〔2025〕104号`、`2026届` 当前都不允许被误拆为 `edition_label`

## Why This Is The Current Repo Truth

- repo 当前 regulation 样本同时混有：
  - 版本标签
  - 状态限定词
  - 届别/年级标题成分
  - 发文字号
- 如果 display-title 统一压成裸年份，会丢失版本语义，也会放大误判风险。

## Updated Surfaces

- `ADR-0040`
- regulation acceptance reference
- regulation promotion runbook
- `institutional_regulations` collection README / canonical profile
- `STATE.md`
- promotion title-splitting regression tests
