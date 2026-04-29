---
doc_type: phase_plan
phase: "01.1"
phase_name: "Bounded Service Navigation Multimodal Probe And Admission"
status: planned
created: 2026-04-20
updated: 2026-04-20
---

# Phase 01.1 Plan

## Objective

对 handbook-derived `中央民族大学学生公寓管理工作流程` 执行一次正式的 bounded multimodal admission gate，回答：

- 多模态是否只适合作为 operator probe
- 还是足以被 admission 为 `service_navigation_document` 的 bounded production materialization candidate

## Why This Phase Exists

当前 `252-255` 页的事实已经很清楚：

- OCR 双跑没有出现明确赢家
- 流程图正文仍未被稳定恢复为可直接消费的 step graph
- 页图本身又明显可读

如果不先完成这个 phase，就会直接把 `Phase 2` 锁死为 OCR-only materialization。
这会把“缺口是 OCR lane 本身不够”与“缺口是 image-heavy flowchart 需要更强的受限视觉读取”混为一谈。

## Locked Inputs

- source selector 固定不变：
  - `source_title=中央民族大学公寓及公费医疗管理规定`
  - `source_handbook_section=中央民族大学公寓及公费医疗管理规定`
  - `source_page_start=252`
  - `source_page_end=255`
- 输入范围固定为 `252-255` 页，不允许扩页。
- probe 只服务于 handbook-derived `service_navigation_document`。
- 不打开 `service_catalog` query-serving。
- 不改写 repo 当前 canonical OCR / MinerU / Paddle routing truth。

## Admission Question To Answer

本 phase 只判断以下三档 outcome 之一：

1. `not admitted`
   - 多模态输出不稳定、越界、幻觉明显，或无法稳定优于当前 OCR lane。
2. `admitted only as bounded probe`
   - 适合 operator/人工辅助，但仍不足以驱动正式 materialization。
3. `admitted as bounded production materialization candidate`
   - 允许 `Phase 2` 规划为受限 hybrid lane，但仍只限这条 handbook-derived target projection。

## Execution Slices

### Slice 1: Freeze Probe Input Contract

- 只使用从 bounded slice 渲染出的 `page-01.png` 到 `page-04.png`。
- page index 与 source page 的映射固定为：
  - `page-01 -> 252`
  - `page-02 -> 253`
  - `page-03 -> 254`
  - `page-04 -> 255`
- 不直接使用 PDF input 做 admission probe。

Reason:

- OpenAI 官方 PDF input 会同时注入 extracted text 与 page images。
- 当前我们要测的是“视觉读取是否补上 OCR 缺口”；若用 PDF input，结论会混入 PDF text extraction 的贡献，无法判断多模态 lane 的真实边界。

### Slice 2: Freeze Probe Output Schema

probe 输出固定为 strict JSON schema，只允许表达 bounded flow graph。

建议 schema 语义固定为：

- `document_title`
- `page_findings`
  - `source_page`
  - `page_heading`
  - `flows`
    - `flow_heading`
    - `audience_scope`
    - `steps`
      - `step_id`
      - `step_text`
      - `next_step_ids`
    - `manual_review_notes`
- `global_manual_review_required`

固定规则：

- 所有字段 required
- object 默认 `additionalProperties: false`
- 不开放任意 metadata bag
- 不允许输出页范围外实体
- 不允许输出“猜测的制度解释”或“流程背后含义”

### Slice 3: Freeze Prompt And Stability Gate

执行时固定：

- 同一组 PNG
- 同一 prompt
- 同一 strict schema
- 至少 3 次重复运行

通过 gate 的最低条件：

- page 253-255 的 `flow_heading` 数量和顺序一致
- 每个 flow 的 `steps[].step_id` 与 step 数量一致
- `next_step_ids` 不出现越界或悬空引用
- 没有出现 source page 外的新步骤、新流程或制度解释性补写
- `manual_review_notes` 只用于标记真实不确定箭头，不允许把整页内容都降级成泛泛总结

如果 3 次重复运行不能同时满足以上条件，则不进入 `bounded production materialization candidate`。

### Slice 4: Freeze Admission Rubric

#### Outcome A: `not admitted`

触发条件任一成立即可：

- 重复运行的步骤数、顺序或边关系频繁漂移
- 明显编造不存在的流程框正文
- 输出持续超出 `252-255` 页范围
- 无法比 OCR-only 结果多恢复出稳定可审的流程正文

#### Outcome B: `admitted only as bounded probe`

触发条件：

- 多模态明显比 OCR-only 更利于人工复核
- 但结构化 step graph 仍不够稳定，或 page 253 等复杂页仍存在高比例结构漂移

Phase 2 consequence:

- `Phase 2` 继续保持 OCR-only materialization
- 多模态只允许作为 operator adjudication/reference lane

#### Outcome C: `admitted as bounded production materialization candidate`

触发条件：

- page 253-255 的 step graph 在重复运行中保持稳定
- `manual_review_notes` 只覆盖局部不确定处
- 输出没有越界和泛化
- 结果明显优于当前 OCR lane 的 title-only / image-reference-heavy 输出

Phase 2 consequence:

- `Phase 2` 升级为 bounded hybrid lane：
  - OCR artifacts 继续保留为 provenance
  - 多模态只负责补齐 image-heavy flowchart body/edges
  - 仍然不改写 repo-wide canonical parser routing

### Slice 5: Freeze Phase 2 Handoff

本 phase 完成后，必须把 `Phase 2` 的边界写死为二选一：

- `OCR-only bounded materialization`
- `OCR + constrained multimodal bounded materialization`

不允许出现第三种模糊状态：

- “先都做一点，后面再看”
- “默认接进 repo-wide multimodal parser”
- “让 operator 临时决定”

## Proposed Write Set

- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/RESEARCH.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/01.1-bounded-service-navigation-multimodal-probe-and-admission/PLAN.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`

## Verification Matrix

- planning verification
  - `Phase 01.1` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `01.1/PLAN.md`
  - `ROADMAP.md` 记录 `Phase 01.1` 已有 1 个 plan
- architecture verification
  - planning truth 明确 probe 只限 `252-255` 页
  - planning truth 明确不把 PDF input 当作 admission probe 输入
  - planning truth 明确多模态仍不是 repo-wide canonical lane
- execution verification
  - 后续真正执行时能对同一组 PNG 做重复运行比对
  - outcome rubric 能清晰决定 `Phase 2` 是 OCR-only 还是 bounded hybrid

## Exit Rule

Phase 01.1 完成时，repo 应达到：

- 已有正式 research 说明为什么 probe 输入必须是 per-page PNG，而不是 bounded PDF
- 已有正式 plan 说明多模态 admission 的 schema、稳定性 gate 与 outcome rubric
- `Phase 2` 不再是默认 OCR-only，而是被明确依赖 `01.1` 的 admission 结果
- 这条线仍严格停留在 handbook-derived `service_navigation_document` 的 bounded target-side hardening，不与 auth、regulation、curriculum 主线耦合
