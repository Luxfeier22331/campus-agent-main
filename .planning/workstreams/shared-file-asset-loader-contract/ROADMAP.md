---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-20
---

# Roadmap: Shared File Asset Loader Contract

## Overview

这条 workstream 覆盖 repo-level shared file asset loader contract。
同一 workstream 内禁止按格式、parser backend 或 source channel 平行拆 lane。

## Phases

- [x] **Phase A: Shared Contract And Boundary Freeze** — 冻结 shared loader 的抽象层、terminal outcomes、provenance、source-specific guardrails，以及 admitted family tranches。
- [x] **Phase B: Bounded Backend Evaluation** — 用真实样本比较 admitted families 的 bounded backend 组合；`.xls` 与 `.doc` 同属 legacy binary Office tranche，`.xlsx` 与 `.docx` 同属 modern OOXML tranche。
- [x] **Phase C: Shared Normalization And Extraction Substrate** — 在 `packages/ingestion-core` 落 package-level substrate。
- [x] **Phase D: Authenticated Notice Attachment Migration** — 把 `authenticated_notice` attachment path 中的 admitted families 迁到 shared substrate，并分别收口 legacy binary Office（`.doc/.xls`）与 modern OOXML（`.docx/.xlsx`）路径。
- [x] **Phase E: Cross-Scope Adoption Matrix And Hardening** — 评估后续 adoption、验证矩阵与文档/runbook 硬化。
- [x] **Phase F: Planning Closeout And Follow-up Routing** — 关闭 planning 漂移，并把剩余 follow-up 正确分流。
- [x] **Phase G: OCR Lane-First Provider Contract Realignment** — 收口 shared file-asset architecture、authenticated-notice OCR lane、runtime/env contract、runbook、tests 与 closeout planning 之间的 provider-first 漂移，恢复 lane-first canonical truth。
- [x] **Phase H: LibreOffice Conversion Runtime Productization** — 把 legacy Office 的 canonical runtime 从 worker-direct `soffice --convert-to` 过渡实现收口到 repo 已冻结的 `internal self-hosted conversion service` 形态，首个实现固定为 `JODConverter + LibreOffice`，并补齐 env / deploy / health / runbook / verification truth。
- [x] **Phase I: OOXML Structured Normalization Contract** — 在 shared loader 内为 `.docx/.xlsx` 引入 post-extraction structured normalization contract，把 OOXML downstream truth 从 source-faithful `text_blocks` 收口成 retrieval-grade structural artifacts。

## Phase Details

### Phase H: LibreOffice Conversion Runtime Productization
**Goal**: 把 legacy Office family 的 canonical runtime 正式收口为 `JODConverter + LibreOffice` self-hosted conversion service，并补齐 repo 对应的 client contract、runtime env、deployment/health、runbook 与 verification truth。
**Depends on**: Phase G
**Requirements**: [H1, H2, H3, H4]
**Requirement Details**:
  - `H1`: 冻结 repo-owned legacy Office conversion service contract，统一 internal HTTP seam、shared-secret admission、timeout 与 `healthz/readyz` 语义。
  - `H2`: 把 `packages/ingestion-core` 的 legacy Office canonical path 从 worker-direct `soffice --convert-to` 改成 service-backed client，同时保持 `.docx/.xlsx` 只是 normalization artifact、不是 source truth。
  - `H3`: 落 operator/runtime truth，包括 service env、deployment shape、worker consumption contract 与 runbook，避免再把“本机装 soffice”冒充完成标准。
  - `H4`: 补齐 fail-close verification，包括 service client tests、worker/substrate regression，以及真实 `.doc/.xls` 资产走 service path 的验证步骤。
**Success Criteria** (what must be TRUE):
  1. repo 已有明确的 `JODConverter + LibreOffice` self-hosted conversion runtime truth。
  2. legacy Office canonical path 不再依赖业务 worker 直接 shell out 到本机 `soffice`。
  3. env / deploy / health / runbook / verification truth 已与代码实现一致。
  4. 真实 `.doc/.xls` 资产已通过新 runtime 路径验证。
**Plans**: 3/3 plans drafted

Plans:
- [x] `phase-h-libreoffice-conversion-runtime-productization/H-01-PLAN.md` — 冻结 service-backed caller seam，完成 core/worker canonical path 迁移与 fail-close tests。
- [x] `phase-h-libreoffice-conversion-runtime-productization/H-02-PLAN.md` — 落独立 `JODConverter + LibreOffice` conversion service、health/readiness/admission contract 与 local compose runtime。
- [x] `phase-h-libreoffice-conversion-runtime-productization/H-03-PLAN.md` — 收口 worker/env/docs/operator truth，并固化真实 `.doc/.xls` closeout evidence。

### Phase H Closeout Truth (2026-04-20)

- `packages/ingestion-core` 的 legacy Office canonical path 已完全切到 service-backed client，不再依赖本机 `soffice` CLI。
- repo 已拥有独立 `apps/legacy-office-conversion-service` 与 `infra/local/docker-compose.legacy-office-conversion.yml`，`/healthz` 与 `/readyz` 均已通过实跑验证。
- worker README、environment docs、architecture doc、runbook 与 env example 已统一到同一组 `LEGACY_OFFICE_CONVERSION_*` / `LIBREOFFICE_SERVICE_*` contract。
- `.tmp/phase-h-libreoffice-runtime-productization/` 已生成真实 authenticated notice `.doc/.xls` service-path evidence bundle。

### Reopen Note (2026-04-20)

- `Phase H` closeout 后补跑的真实 `.doc/.xls -> .docx/.xlsx -> OOXML` evidence 已证明：当前 OOXML extraction 是 source-faithful、可消费的，但 repo 仍缺少 shared post-extraction structured normalization contract。
- 这不是 legacy Office conversion runtime 的 reopen，也不是 collection-specific cleanup / chunking 问题；缺口位于 shared file asset loader 自己的 OOXML downstream contract。
- 因此 workstream 重新进入 active，并新增 `Phase I` 承接 OOXML structured normalization。

### Phase I: OOXML Structured Normalization Contract
**Goal**: 为 modern OOXML family（`.docx/.xlsx`）新增 repo-owned post-extraction structured normalization contract，使 shared loader 能输出稳定的 heading/table/workbook-sheet-row-cell structural artifacts，而不是继续把 retrieval-grade consumption 建立在 source-faithful `text_blocks` 猜测上。
**Depends on**: Phase H
**Requirements**: [I1, I2, I3, I4]
**Requirement Details**:
  - `I1`: 冻结 shared OOXML structured normalization contract，明确它位于 deterministic extraction 之后，不回写 source truth，也不把 collection-specific cleanup 反向塞进 extractor。
  - `I2`: 为 `docx` 保留 heading / paragraph / list / table 等结构语义；为 `xlsx` 保留 workbook / sheet / range / row / cell / formula / displayed-value / continuation-row semantics，并用显式 flags 表达 deterministic forward-fill 或 merged/continued provenance。
  - `I3`: 让 shared loader 的 downstream consumer 能消费 normalized structural artifacts，而不是继续只依赖 `ExtractionOutcome.text_blocks` 承担长期 truth。
  - `I4`: 以真实 `.docx/.xlsx` 样本以及 legacy Office 转换后的 OOXML 产物补齐质量验证，证明归一化提升 retrieval-grade fidelity，同时不破坏 source-faithful extraction。
**Success Criteria** (what must be TRUE):
  1. repo 已有明确的 OOXML post-extraction structured normalization contract。
  2. `.docx` / `.xlsx` 的 retrieval-grade structural semantics 不再依赖下游猜测性补全。
  3. shared loader 能同时保留 source-faithful extraction evidence 与 normalized structural artifacts。
  4. 真实样本验证能证明 OOXML normalization 改善 downstream structural quality，且不会把 collection-specific business cleanup 混回 shared extractor。
**Plans**: 1/1 plans drafted

Plans:
- [x] `phase-i-ooxml-structured-normalization-contract/PLAN.md` — 冻结 OOXML structured normalization contract，落 `docx/xlsx` normalizer，并把至少一条 shared consumer path 迁到 normalized structural artifact。

### Phase I Closeout Truth (2026-04-20)

- `packages/ingestion-core` 现已拥有 repo-owned `build_ooxml_layout_elements_bytes(...)`，`.docx/.xlsx` 不再只停留在 `ExtractionOutcome.text_blocks`
- 真实 `.docx` 样本不再全部降级成 plain paragraphs；标题与 section-like 行现在会被结构化为 headings，列表和表格也会保留独立 row semantics
- 真实 `.xlsx` 样本的 continuation handling 已从“任意空列回填”收紧为“只回填 leading repeated cells”，避免把中间空列误判成上一行值
- `authenticated_notice_source_projections.py` 已成为首条 preferential consumer path：text-extractable attachment 会持久化 `layout_elements_bytes`，并优先从 structured rows 构造 markdown / document units
- repo 已新增 `scripts.verify_ooxml_structured_normalization`；它复用 Phase H 的真实 authenticated_notice 样本清单，生成 `.tmp/phase-i-ooxml-structured-normalization/` evidence bundle
- 因此这条 workstream 现已 `9/9 phases complete`
