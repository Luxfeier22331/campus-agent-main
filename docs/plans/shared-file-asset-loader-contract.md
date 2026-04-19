---
doc_type: plan
status: completed
created: 2026-04-19
updated: 2026-04-20
---

# Shared File Asset Loader Contract And Migration

## 文档边界

本文固定一条新的 repo-level workstream：

- shared file asset loader / normalization / extraction contract

它负责：

- 统一 repo 内“文件型资产”的 package-level 处理契约
- 为 initial admitted families 定义统一的 normalization / extraction / provenance 语义；当前非平凡 backend 评估范围固定为 legacy binary Office（`.doc/.xls`）、modern OOXML（`.docx/.xlsx`）、PDF、图片
- 把当前散落在 source-specific path 内的文件提取逻辑收口成 shared substrate

它不负责：

- 改写 `official_web` 的 page-level source unit
- 改写 `authenticated_notice_portal` 的 notice-level source unit
- 直接打开任何新的 query-serving surface
- 把 OCR lane、manual review lane 或 source-specific projection 语义压平成单一 parser 黑盒
- 把对象存储语义改写成数据库或本地目录 truth

## 当前生命周期状态

- 当前状态是 `completed`
- 这是一个新的 repo-level data-plane workstream，不再挂在 `authenticated-notice -> regulation downstream consumption` 的 bounded closeout 下
- 它可以与其他独立 workstreams 并行存在，但同一 workstream 内不再按格式或 parser backend 平行拆 lane
- 2026-04-19 这条线在 `Phase F` closeout 后又重新命中 reopen 条件：shared OCR routing owner 已经转成 lane-first，但 runtime/env/runbook/tests/planning 仍保留 provider-first 的 `Paddle primary + OCR_MINERU supplemental` 语义
- 2026-04-20 `Phase G` 已完成：上述 OCR provider-contract drift 已收口到代码、测试、runbook、env docs/templates 与 planning truth
- 同日 `Phase H` 也已完成：legacy Office canonical runtime 已正式收口为 repo-owned `JODConverter + LibreOffice` self-hosted conversion service，worker/env/runbook/verification truth 与真实 `.doc/.xls` evidence 均已落盘

## 直接结论

repo 需要一条单独的 `shared file asset loader` workstream。

它必须作为一条共享 data-plane contract workstream 推进，固定顺序如下：

1. shared contract / boundary freeze
2. bounded backend evaluation
3. shared normalization / extraction substrate implementation
4. authenticated notice attachment migration
5. cross-scope adoption matrix / hardening
6. planning closeout / follow-up routing
7. OCR lane-first provider contract realignment
8. LibreOffice conversion runtime productization

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
- legacy binary Office（`.doc/.xls`）不允许在 `ingestion-core` 内手写二进制 parser；只允许显式 normalizer 或明确 terminal contract 接入
- `.xls` 与 `.doc` 在同一 tranche 内处理，不单独挂到 spreadsheet reopen lane
- modern OOXML（`.docx/.xlsx`）在同一 tranche 内处理，不按 word / spreadsheet 再拆 lane
- 现有 source-specific `.xlsx` 解析路径不反向定义 forward contract
- OCR lane、`manual_review_required`、`reference_only`、`unsupported_binary` 继续是 repo-owned terminal semantics，不交给第三方 parser 自行决定
- 对象 bytes 的长期语义仍是 `S3-compatible object storage`
- legacy binary Office tranche 包含 `.doc/.xls`，但 source path admission 仍必须显式落到 shared conversion contract，而不是被 family 定义自动放宽
- 当前 repo code truth 下，`authenticated_notice` admitted default lane 已覆盖 `doc/docx/xls/xlsx`；其中 `.doc/.xls` 固定先走 service-backed legacy Office normalization，再进入 deterministic OOXML extraction

## Phase A: Shared Contract And Boundary Freeze

目标：

- 冻结 repo 级 file asset loader 的抽象边界、输入输出 contract、terminal outcomes 与 provenance 语义

退出条件：

- 已明确 shared loader 的 canonical layer
- 已明确不纳入 shared loader 的 source-specific page projection
- 已明确 legacy normalization、modern extraction、OCR/manual review 的边界

## Phase B: Bounded Backend Evaluation

目标：

- 用真实样本比较 admitted families 的 bounded backend 组合，决定 shared substrate 的 family adapters；其中 `.xls` 与 `.doc` 同属 legacy binary Office tranche，`.xlsx` 与 `.docx` 同属 modern OOXML tranche

退出条件：

- 已完成 modern OOXML（`.docx/.xlsx`）/ PDF / image / legacy binary Office（`.doc/.xls`）的 bounded benchmark
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

- 先把 `authenticated_notice` 的 admitted file asset families 迁到 shared substrate，并分别收口 legacy binary Office（`.doc/.xls`）与 modern OOXML（`.docx/.xlsx`）路径

退出条件：

- attachment classification 与 file extraction 不再耦合在单个 source projection module 内
- `.doc`、`.xls`、`.docx`、`.xlsx`、PDF / image OCR families 都按 Phase B 决策进入 shared contract 或 explicit terminal contract

## Phase E: Cross-Scope Adoption Matrix And Hardening

目标：

- 评估并推进 repo 其他 file-like asset path 的 adoption matrix、verification matrix 与 docs hardening

退出条件：

- 已明确哪些 scope 立即接入、哪些继续 deferred
- verification matrix 与 docs/runbook 已和代码真相对齐

### Phase E Closeout Truth (2026-04-19)

adoption matrix 固定为：

- landed：
  - `raw_ingestion.py` / `register_raw_asset.py` 直接消费 `file_asset_routing.py` typed routing
  - `apps/ingestion-worker` legacy Office normalization worker 只保留 shell，canonical owner 固定为 `file_asset_legacy_office.py`
  - `authenticated_notice_source_projections.py` 直接消费 `file_asset_text_extractable.py`、`parse_online_ocr_bytes(...)` 与 shared extraction payload contract
  - `authenticated_notice_import.py` / `authenticated_notice_source_truth_replay.py` / `authenticated_notice_closeout_execution.py` 继续消费 shared artifact / payload helpers
- explicit deferred：
  - `official_web` page-linked / downloaded file adoption
  - `authenticated_notice` `file_release` surface
  - semantic-image multimodal enrichment
- rerouted to other workstreams / out of scope：
  - `internal_notice -> regulations/*` downstream consumption
  - query-serving reopening
  - collector live run / portal control plane

hardening posture 固定为：

- `packages/ingestion-core` runtime dependencies 已移除 `xlrd`
- 历史 `raw_asset_typing.py` / `online_ocr_routing.py` compatibility shim 已删除，不再保留 forward import surface
- legacy binary Office tranche 继续保持 `.doc/.xls` 同一 owner；`authenticated_notice` 现已通过 service-backed lane 同时承接 `.doc/.xls`
- 本 phase 不扩写 runbook，因为 operator contract 没有变化

verification matrix 固定为：

- `uv run --all-packages python -m unittest tests.ingestion.test_file_asset_substrate`
  - shared file asset contract、OOXML extraction、legacy Office normalization 与 dependency/shim hardening
- `uv run --all-packages python -m unittest tests.ingestion.test_process_raw_ingestion_job`
  - raw ingestion OCR bytes bridge 与 typed routing
- `uv run --all-packages python -m unittest tests.ingestion.test_online_ocr_routing`
  - canonical OCR routing owner 仍保持在 `file_asset_routing.py`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_source_projections`
  - authenticated notice attachment extraction 对 shared substrate 的消费
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_import tests.ingestion.test_import_authenticated_notice_export_worker`
  - import / export worker 对 shared payload 和 source artifact helpers 的消费
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_closeout_async`
  - closeout / replay lane 没有反向持有 shared parser truth

## Phase F: Planning Closeout And Follow-up Routing

目标：

- 关闭这条 workstream 的 planning 漂移，并把余下非当前优先级的 adoption 或 backend follow-up 正确分流

退出条件：

- `.planning/WORKSTREAMS.md`、本 workstream `STATE.md` 与相关 docs 已同步
- 不把一次 authenticated notice 迁移成功误写成 repo 全面统一完成

### Phase F Closeout Truth (2026-04-19)

- 这条 workstream 当前已 completed，不再保留 active implementation slice
- repo registry 已同步：
  - `.planning/WORKSTREAMS.md` 不再把这条线保留在过期的 `Phase C`
  - workstream truth 已固定为 `6/6` phases complete
- future reopen 只允许发生在：
  - 新的 repo-level file-like asset adoption demand 被提升为 active
  - 当前 admitted family truth 被显式改写
  - `official_web` linked-file adoption、`authenticated_notice file_release` 或 semantic-image enrichment 被重新 admission 为 active implementation
- 当前不会因为 `Phase E` 已明确 deferred / rerouted 的 scope 继续维持一个空转 active workstream

### Reopen Note (2026-04-19)

- post-closeout audit 发现：`file_asset_routing.py` 已经把 typed PDF / complex image 路由建模成 `MinerU primary -> Paddle fallback`，但 `raw_ingestion.py`、`authenticated_notice_source_projections.py`、env docs/templates、runbook、doctor env 与多处 tests 仍把 Paddle 写成 canonical primary provider
- 这不是单一实现 bug，而是 shared file-asset workstream 自己遗留的 provider-contract drift
- 因此 `Phase F` 的 closeout 只能保留为历史状态，当前 workstream 需要进入 `Phase G`

## Phase G: OCR Lane-First Provider Contract Realignment

目标：

- 收口 shared file-asset architecture、authenticated-notice OCR lane、runtime/env contract、runbook、tests 与 closeout planning 之间的 provider-first 漂移

退出条件：

- OCR canonical truth 重新回到 lane-first，而不是 provider-first
- `raw_ingestion.py` 与 `authenticated_notice` replay shell 不再强制把 Paddle 视为 canonical primary provider
- env docs/templates 不再把 `OCR_MINERU_*` 表达成“第二 provider”这一条 repo-level canonical truth
- runbook、doctor env、tests 与 planning state 全部和 lane-first routing owner 对齐

### Phase G Closeout Truth (2026-04-20)

- `authenticated_notice_source_projections.py` 已不再把 `paddleocr_async_jobs` 写成 replay 唯一 canonical provider；MinerU provider 响应会先适配成 canonical provider payload，再进入既有 attachment artifact/materialization 流程
- `raw_ingestion.py` 已不再把 `mineru_api` 视为 compare-only primary forbidden mode；`source_truth_only` 现在按 lane-first routing 解释当前已配置 provider 集合，并在需要时先把 MinerU 结果归一化后再进入下游
- env docs/templates、runbook 与 tests 已不再把 `OCR_MINERU_*` 表达成 repo-level “second provider canonical truth”，也不再把 authenticated-notice replay 固定写成 Paddle-only operator contract
- `Phase G` closeout 已成立，但它不再代表整个 workstream fully completed，因为 legacy Office conversion runtime productization 仍未收口

### Reopen Note (2026-04-20, later)

- post-closeout review 发现：repo 已在 architecture 层明确冻结 legacy binary Office 的长期 production posture 为 `internal self-hosted conversion service`，并推荐 `JODConverter + LibreOffice`
- 但当前代码真相仍停在 `packages/ingestion-core/.../file_asset_legacy_office.py` 直接调用本机 `soffice --convert-to`
- 这不是“少装一个包”的本机环境问题，而是 shared file-asset workstream 还没有把 LibreOffice-family conversion runtime 变成 repo-owned canonical runtime truth
- 因此这条线需要继续 reopen 到 `Phase H`

## Phase H: LibreOffice Conversion Runtime Productization

目标：

- 把 legacy Office canonical runtime 从 worker-direct `soffice --convert-to` 过渡实现收口到 repo 已冻结的 `internal self-hosted conversion service` 形态，并把 LibreOffice-family conversion 的 env / deploy / health / runbook / verification truth 一并落盘

执行要求：

- `H1`: 冻结 repo-owned legacy Office conversion service contract，统一 internal HTTP seam、shared-secret admission、timeout 与 `healthz/readyz` 语义
- `H2`: 把 `packages/ingestion-core` 的 legacy Office canonical path 改成 service-backed client，同时保持 `.docx/.xlsx` 只是 normalization artifact
- `H3`: 落 operator/runtime truth，包括 service env、deployment shape、worker consumption contract 与 runbook
- `H4`: 补齐 fail-close verification，包括 service client tests、worker/substrate regression，以及真实 `.doc/.xls` 资产走 service path 的验证步骤

当前执行拆分：

- `H-01-PLAN.md`: service-backed caller seam、core/worker canonical path 迁移、fail-close regression
- `H-02-PLAN.md`: standalone `JODConverter + LibreOffice` conversion service runtime 与 local compose/health gate
- `H-03-PLAN.md`: worker/env/docs/operator truth、verification helper、真实 `.doc/.xls` closeout evidence

退出条件：

- `JODConverter + LibreOffice` 作为首个自部署实现被正式收口到 repo planning truth
- `packages/ingestion-core` 继续只消费 shared conversion contract，而不是直接拥有 office process lifecycle
- legacy Office conversion 的 operator contract、runtime env、healthcheck、deployment/runbook 与 verification matrix 已落盘
- 不再把“本机安装 `soffice`”误写成这条 workstream 的完成标准

### Phase H Closeout Truth (2026-04-20)

- `packages/ingestion-core` 已新增 typed `legacy_office_conversion_client.py`，并把 `file_asset_legacy_office.py` canonical path 从 local `soffice` CLI 迁移到 internal HTTP seam
- repo 已拥有独立 `apps/legacy-office-conversion-service`、`infra/local/docker-compose.legacy-office-conversion.yml` 与 `GET /healthz` / `GET /readyz` readiness gate
- worker/env/docs/runbook 现已统一到 `LEGACY_OFFICE_CONVERSION_BASE_URL`、`LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET` 与 optional `LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS`
- `scripts.verify_legacy_office_conversion_runtime` 已用真实 authenticated notice source-bucket `.doc/.xls` 样本生成 `.tmp/phase-h-libreoffice-runtime-productization/` evidence bundle
- workstream 当前重新回到 completed 状态；后续只有在 repo-level file-like asset adoption 或 legacy Office runtime contract 再次发生结构性变化时才 reopen

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md` 与本 workstream `STATE.md`
2. 先完成 contract / boundary freeze，再决定 backend
3. 再实现 shared substrate，然后迁移首个 source channel
