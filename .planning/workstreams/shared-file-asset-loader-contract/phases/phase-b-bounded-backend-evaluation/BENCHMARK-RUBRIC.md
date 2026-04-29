---
phase: "B"
artifact: "benchmark-rubric"
created: 2026-04-19
updated: 2026-04-19
status: active
---

# Phase B Benchmark Rubric

## Purpose

这份 rubric 定义 Phase B bounded backend evaluation 的统一评估标准。

它不是实现文档，也不是 closeout artifact；它只负责约束“如何评估”。

## Hard Gates

以下维度不通过，则 candidate 不能进入 Phase C trunk implementation。

### Structure Retention

- `docx`
  - heading / paragraph / list / table block boundaries survive extraction
  - hyperlink / embedded-image refs can be surfaced
- `xlsx`
  - workbook / sheet / row structure survives extraction
  - merged cells / formulas / cached values remain recoverable
- PDF / document image
  - reading order is materially correct
  - table and layout blocks are not collapsed into unusable long text

### Terminal Outcome Correctness

- failure path is explicit
- no silent fallback from deterministic extraction into guessed text
- provider success state does not equal canonical success by itself
- results can map into repo-owned terminal outcomes:
  - `reference_only`
  - `manual_review_required`
  - `no_extractable_text`
  - `unsupported_binary`

### Provenance Completeness

every evaluated route must be able to emit:

- source storage ref
- source hash
- engine / adapter name
- engine / adapter version
- normalized artifact ref when applicable
- warnings / failure reason

### Operator Posture

- deploy shape is explicit
- route does not depend on ad hoc shell use inside worker processes
- route does not assume host-global binaries are preinstalled
- health / readiness / timeout / concurrency expectations are expressible

## Secondary Tradeoffs

### Output Richness

- hyperlink fidelity
- image refs
- sheet metadata
- table range fidelity
- formula vs cached value distinction

### Salvage Value

- fallback lane increases usable output without weakening fail-close semantics
- fallback lane does not create false-success pressure

### Cost / Complexity

- deploy footprint
- operational complexity
- upgrade / replacement path
- provider lock-in pressure

## Required Evaluation Record Fields

每次评估至少要记录：

- sample id
- family
- candidate
- passes hard gates: `yes/no`
- major failure mode
- retained semantics
- provenance quality summary
- operator posture summary
- recommendation:
  - `admit`
  - `fallback-only`
  - `reject`
