---
doc_type: plan
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Shared File Asset Loader Contract And Migration

## 文档边界

本文固定一条新的 repo-level workstream：

- shared file asset loader / normalization / extraction contract

它负责：

- 统一 repo 内“文件型资产”的 package-level 处理契约
- 为 legacy Office、modern Office、PDF、图片等文件资产定义统一的 normalization / extraction / provenance 语义
- 把当前散落在 source-specific path 内的文件提取逻辑收口成 shared substrate

它不负责：

- 改写 `official_web` 的 page-level source unit
- 改写 `authenticated_notice_portal` 的 notice-level source unit
- 直接打开任何新的 query-serving surface
- 把 OCR lane、manual review lane 或 source-specific projection 语义压平成单一 parser 黑盒
- 把对象存储语义改写成数据库或本地目录 truth

## 当前生命周期状态

- 当前状态是 `active`
- 这是一个新的 repo-level data-plane workstream，不再挂在 `authenticated-notice -> regulation downstream consumption` 的 bounded closeout 下
- 它可以与其他独立 workstreams 并行存在，但同一 workstream 内不再按格式或 parser backend 平行拆 lane

## 直接结论

repo 需要一条单独的 `shared file asset loader` workstream。

它必须作为一条共享 data-plane contract workstream 推进，固定顺序如下：

1. shared contract / boundary freeze
2. bounded backend evaluation
3. shared normalization / extraction substrate implementation
4. authenticated notice attachment migration
5. cross-scope adoption matrix / hardening
6. planning closeout / follow-up routing

原因固定为：

- 当前问题已经不只是 `.doc` 补洞，而是 repo 内 shared file asset handling contract 不统一
- `authenticated_notice` 当前把分类、提取、terminal outcome 混在 source projection 里；这不应继续作为 shared truth
- `official_web` 的 page-level source-truth 和 file asset extraction 不是同一个抽象层，不能被一个“universal parser”硬并
- shared loader 真正应统一的是 `asset typing -> normalization -> extraction -> terminal outcome -> provenance`，而不是 source-specific page builder

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/current-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/architecture/official-web-source-truth-contract.md`
- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

## 固定执行规则

- shared loader 的 canonical owner 固定为 `packages/ingestion-core`
- `apps/*` 只允许承接 runtime shell / worker entry，不反向拥有 shared parser truth
- page-level web content projection 继续保留 source-specific path；shared loader 只处理 file-like assets
- legacy binary Office 不允许在 `ingestion-core` 内手写二进制 parser；只允许显式 normalizer 接入
- OCR lane、`manual_review_required`、`reference_only`、`unsupported_binary` 继续是 repo-owned terminal semantics，不交给第三方 parser 自行决定
- 对象 bytes 的长期语义仍是 `S3-compatible object storage`

## Phase A: Shared Contract And Boundary Freeze

目标：

- 冻结 repo 级 file asset loader 的抽象边界、输入输出 contract、terminal outcomes 与 provenance 语义

退出条件：

- 已明确 shared loader 的 canonical layer
- 已明确不纳入 shared loader 的 source-specific page projection
- 已明确 legacy normalization、modern extraction、OCR/manual review 的边界

## Phase B: Bounded Backend Evaluation

目标：

- 用真实样本比较 bounded backend 组合，决定 shared substrate 的 family adapters

退出条件：

- 已完成 modern Office / PDF / image / legacy Office 的 bounded benchmark
- 已给出 backend 取舍，不再停留在“可能用 Docling / Unstructured / Tika / native parser”的并列状态

## Phase C: Shared Normalization And Extraction Substrate

目标：

- 在 `packages/ingestion-core` 落 shared asset loader contract 与 family adapter substrate

退出条件：

- shared typing / normalization / extraction contract 已成立
- provenance / diagnostics / artifact refs 已落盘
- source-specific path 可以无歧义接入 shared substrate

## Phase D: Authenticated Notice Attachment Migration

目标：

- 先把 `authenticated_notice` 的 file asset path 迁到 shared substrate

退出条件：

- attachment classification 与 file extraction 不再耦合在单个 source projection module 内
- `.doc`、`docx/xls/xlsx`、OCR families 都走 shared contract

## Phase E: Cross-Scope Adoption Matrix And Hardening

目标：

- 评估并推进 repo 其他 file-like asset path 的 adoption matrix、verification matrix 与 docs hardening

退出条件：

- 已明确哪些 scope 立即接入、哪些继续 deferred
- verification matrix 与 docs/runbook 已和代码真相对齐

## Phase F: Planning Closeout And Follow-up Routing

目标：

- 关闭这条 workstream 的 planning 漂移，并把余下非当前优先级的 adoption 或 backend follow-up 正确分流

退出条件：

- `.planning/WORKSTREAMS.md`、本 workstream `STATE.md` 与相关 docs 已同步
- 不把一次 authenticated notice 迁移成功误写成 repo 全面统一完成

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md` 与本 workstream `STATE.md`
2. 先完成 contract / boundary freeze，再决定 backend
3. 再实现 shared substrate，然后迁移首个 source channel
