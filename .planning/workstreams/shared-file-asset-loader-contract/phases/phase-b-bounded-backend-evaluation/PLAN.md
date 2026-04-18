---
doc_type: phase_plan
phase: "B"
phase_name: "Bounded Backend Evaluation"
status: planned
created: 2026-04-19
updated: 2026-04-19
---

# Phase B Plan

## Objective

把 shared file asset loader 的剩余技术选型收口成 implementation-ready backend decisions，而不是继续维持“若干工具都可能行”的开放状态。

## Why This Phase Exists

Phase A 已经解决了“统一什么、不统一什么”的问题，但 Phase C/Phase D 仍然缺少可直接实现的 family-by-family entry choice：

- legacy binary Office 虽已冻结为 conversion-first，但还缺 baseline adapter、operator contract 与 fail-close boundary
- modern OOXML 已冻结为 deterministic structured extraction，但还缺首个实现路线
- complex PDF / document image / simple image / semantic image 的 routing threshold 还没落盘
- 当前 repo 代码里仍保留 `.xls -> xlrd`、`.xlsx -> source-specific XML parser`、`.doc -> worker wrapper` 之类局部现实；如果 Phase B 不先关掉这些 open items，Phase C 很容易被遗留代码拖回 patchwork

因此 Phase B 必须把研究范围限制在 Phase A 已冻结 posture 内，用真实样本完成 bounded benchmark 与 decision closure。

## External References

- MinerU docs:
  - https://mineru.net/doc/docs/index_en/
- PaddleOCR docs:
  - https://www.paddleocr.ai/main/en/index.html
- JODConverter:
  - https://jodconverter.github.io/jodconverter/latest/
- Collabora document conversion:
  - https://www.collaboraonline.com/document-conversion/
- OpenDocument / OOXML packaging references only as format background:
  - https://learn.microsoft.com/en-us/office/open-xml/open-xml-sdk

## Decisions To Freeze

1. Phase B 是 bounded evaluation，不是 reopen architecture。
2. candidate set 按 family 固定为：
   - legacy binary Office
     - baseline: `JODConverter + LibreOffice`
     - stronger follow-up candidate: `Collabora Online REST`
     - rejected as defaults: in-process `soffice --convert-to`, external conversion SaaS, `Apache OpenOffice`
   - modern OOXML
     - candidates 限于 deterministic structured extraction 路线
     - rejected as forward default: `openpyxl`, `xlrd`, OCR-first fallback, universal black-box parser
   - PDF / document image
     - `MinerU` 负责 complex/layout-sensitive lane
     - `Paddle` 负责 simple OCR / salvage lane
   - semantic image
     - multimodal 只做 enrichment，不承担 canonical document parsing
3. Phase B 输出必须是 repo-owned decision artifacts：
   - canonical closeout artifact: `DECISION-PACKAGE.md`
   - support artifacts:
     - `BENCHMARK-RUBRIC.md`
     - `SAMPLE-MATRIX.md`
     - `ROUTING-WORKSHEET.md`
   - no wildcard quick-note path may substitute for the canonical closeout artifact
4. Phase B 不以“当前代码里已有什么”作为首要判断依据；当前代码只提供 migration pressure，不提供 architecture authority。

## Execution Slices

### Slice 1: Freeze Benchmark Rubric

- 定义每类 family 的统一评估维度：
  - structure retention
  - table fidelity
  - read order / layout correctness
  - formula / displayed value retention（仅 `xlsx`）
  - terminal outcome correctness
  - provenance completeness
  - operator cost / deploy posture
- 明确哪些维度是 hard gate，哪些是 secondary tradeoff
- deliverable:
  - `BENCHMARK-RUBRIC.md`

### Slice 2: Freeze Sample Matrix

- 形成最小 benchmark corpus：
  - `.doc`
  - `.xls`
  - `.docx`
  - `.xlsx`
  - born-digital PDF
  - scanned or layout-heavy PDF
  - document image
  - semantic image
- 为每类样本写清：
  - source channel provenance
  - expected terminal family
  - expected risk points
- deliverable:
  - `SAMPLE-MATRIX.md`

### Slice 3: Run Family-Bounded Evaluation

- legacy binary Office：
  - 验证 conversion success/failure behavior
  - 验证 normalized artifact ownership 与 fail-close rule
- modern OOXML：
  - 比较 deterministic structured extraction candidates
  - 验证 `docx` 结构与 `xlsx` workbook/sheet/table semantics 保留
- PDF / image：
  - 固化 `MinerU` / `Paddle` 各自负责的 lane
  - 识别需要 multimodal enrichment 的 semantic-image trigger
- deliverables:
  - sample-by-sample evaluation records
  - `ROUTING-WORKSHEET.md`

### Slice 4: Produce Decision Artifacts

- 为每个 family 产出：
  - chosen entry implementation
  - rejected alternatives
  - known limitations
  - operator/deployment assumptions
  - Phase C handoff note
- canonical closeout artifact must also record:
  - sample coverage
  - scoring result
  - deferred to `Phase C` / `Phase D` / future hardening
  - final disposition: `admit` / `fallback-only` / `reject`
- deliverable:
  - `DECISION-PACKAGE.md`

### Slice 5: Sync Planning Truth Forward

- 将 Phase B 决策同步回：
  - workstream `STATE.md`
  - `docs/plans/shared-file-asset-loader-contract.md`（如需）
  - 后续 Phase C / D context
- 明确哪些 follow-up 留在 future hardening，不再占住当前 implementation critical path

## Benchmark Matrix

- legacy binary Office
  - conversion completeness
  - converted OOXML structural sanity
  - failed conversion terminal outcome
- modern OOXML
  - heading / paragraph / list / table retention
  - workbook / sheet / merged-cell / formula / displayed-value retention
  - chunk-ready structural segmentation quality
- PDF / document image
  - reading order
  - layout blocks
  - table capture
  - OCR reliability
- semantic image
  - whether multimodal adds meaningful non-OCR semantics
  - whether enrichment can stay auxiliary without overriding canonical extraction

## Proposed Write Set

- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/SPEC.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/CONTEXT.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/PLAN.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/RESEARCH.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/BENCHMARK-RUBRIC.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/SAMPLE-MATRIX.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/ROUTING-WORKSHEET.md`
- `.planning/workstreams/shared-file-asset-loader-contract/phases/phase-b-bounded-backend-evaluation/DECISION-PACKAGE.md`
- workstream `STATE.md` and, if needed, `docs/plans/shared-file-asset-loader-contract.md`

## Exit Rule

Phase B 完成后，repo 应达到：

- 每个 admitted family 都有 implementation-ready entry choice
- `DECISION-PACKAGE.md` 作为 canonical closeout artifact 已完整落盘
- legacy binary Office conversion baseline 与 operator contract 已关闭讨论
- modern OOXML deterministic extraction 不再停留在抽象口号
- `MinerU` / `Paddle` / multimodal 的 routing threshold 已落盘
- Phase C 可以直接进入 shared substrate implementation，而不是继续做选型 research
