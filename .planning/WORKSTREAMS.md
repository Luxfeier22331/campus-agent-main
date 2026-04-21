---
doc_type: index
status: active
created: 2026-04-19
updated: 2026-04-22
---

# Workstreams

`WORKSTREAMS.md` 是 repo 级 workstream registry。
它负责记录哪些 workstreams 当前存在、状态如何、入口文档是什么，以及哪些条目已经落成原生 `.planning/workstreams/<slug>/` 目录。

它不替代每条 workstream 自己的 `STATE.md`、`ROADMAP.md`、`REQUIREMENTS.md`。

## Shared Planning Contract

- `PROJECT.md`
  - repo 级产品范围、关键决策与 merged/worktree truth
- `WORKSTREAMS.md`
  - repo 级 workstream registry；active / deferred / backlog / legacy 的唯一总览
- `.planning/workstreams/<slug>/README.md`
  - native workstream 的人工入口；先解释这条线的边界、状态与应继续查看的 `REQUIREMENTS / ROADMAP / STATE`
- `.planning/workstreams/<slug>/STATE.md`
  - 单条 workstream 的当前状态、current slice、blockers、verification 与 continuity
- `.planning/workstreams/<slug>/ROADMAP.md`
  - 单条 workstream 的固定顺序与 phase 状态
- `.planning/workstreams/<slug>/REQUIREMENTS.md`
  - 单条 workstream 的目标、范围、non-goals 与 success criteria
- `.planning/seeds/`
  - dormant future follow-up；记录 why / trigger / breadcrumbs，供后续 milestone 或新 workstream 恢复时再拾起
- `.planning/runtime/`
  - gitignored 的本地 operator 配置、claim lease、claim history 与 session pointer 辅助状态；不承担 tracked planning truth
- `.planning/legacy-flat/`
  - 迁移前的 flat planning archive；仅保留历史 phase / milestone 参考，不再承载当前执行真相
- `.planning/quick/`、`.planning/todos/`、`.planning/codebase/`、`.planning/research/`
  - 当前继续保持 repo 共享，不按 workstream 拆分

## Active

| Workstream | Slug | Native Dir | Entry | Current Phase | Current Slice |
|------------|------|------------|-------|---------------|---------------|
| `document site and canonical reader` | `document-site-and-canonical-reader` | `yes` | `.planning/workstreams/document-site-and-canonical-reader/README.md` | `Phase 2` | 新建文档站独立 workstream；当前收口 published reader assets、`app-api` docs seams、canonical reader model 与 source-card jump contract，不做 donor transplant 式 shortcut |
| `authenticated-notice -> regulation downstream consumption` | `authenticated-notice-regulation-consumption` | `yes` | `.planning/workstreams/authenticated-notice-regulation-consumption/README.md` | `Phase 6` | 已恢复这条 bounded downstream workstream；当前先收口 `institutional_regulations` 与 `scoped_rules` 的 target-side chunk-prep / validation parity，再继续 `11` 条 admitted target rerun 与 acceptance evidence freeze |
| `repo-wide codebase decomposition` | `repo-wide-codebase-decomposition` | `yes` | `.planning/workstreams/repo-wide-codebase-decomposition/README.md` | `Phase 5` | 冻结 repo-wide oversized handwritten code inventory，并把 ingestion / retrieval / eval / app surfaces / tests 的所有 admitted split debt 映射到后续 phases；明确排除 vendor / generated / lockfiles |
| `eval` | `eval` | `yes` | `.planning/workstreams/eval/README.md` | `Phase 1` | 新建 shared eval workstream；当前先冻结 `packages/evals`、golden dataset / case governance、benchmark artifact lifecycle、operator publish seam 与 CI/release-gate automation 的 owner 边界，不把 domain truth 或 operator panel owner 混进来 |

## Completed

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `execution capability family convergence` | `execution-capability-family-convergence` | `yes` | `docs/plans/archive/completed/execution-capability-family-convergence.md` | 只有在 repo 重新 admission raw runtime target family rename、显式改写 `selected_target` / `selectedTarget` 语义，或新增 capability family 需要重开 repo-wide naming / label convergence 规则时才恢复 |
| `bounded agentic retrieval productization` | `bounded-agentic-retrieval-productization` | `yes` | `docs/plans/archive/completed/bounded-agentic-retrieval-productization.md` | 只有在 repo 重新 admission 新的 retrieval step / planner-executor lifecycle、某个具体产品面决定正式消费 generic `live_source_lookup`、显式改写 raw retrieved trace / supporting evidence / operator observability contract，或把 non-current runtime acceptance 提升为 retrieval owner 时才恢复 |
| `operator observability / control-plane` | `operator-observability-control-plane` | `yes` | `docs/plans/archive/completed/operator-observability-control-plane-foundation.md` | 只有在 repo 重新 admission 新的 operator observability domain、显式改写 `app-api` owned operator truth / sink participation contract，或 panel 需要从 read-only observability control-plane 扩成新的 write/action surface 时才恢复 |
| `shared product surfaces acceptance / hardening` | `shared-product-surfaces-acceptance-hardening` | `yes` | `docs/plans/archive/completed/shared-product-surfaces-acceptance-hardening.md` | 只有在 public auth family / same-site auth contract / Turnstile posture 被显式改写、public browser answer contract 再次出现 raw specialist locator 泄漏或 curriculum semester chunk-boundary corruption，或 shared `app-api + public-chat-web + protected-panel-web` 联合验收被重新 admission 为 active hardening 时才恢复 |
| `shared file asset loader contract` | `shared-file-asset-loader-contract` | `yes` | `docs/plans/archive/completed/shared-file-asset-loader-contract.md` | 只有在新的 admitted file asset family 被提升为 active、当前 canonical parser/normalization lane 被显式改写，或 deferred cross-scope adoption 被重新 admission 为 active implementation 时才恢复 |
| `product-path safety / prompt / grounding governance` | `product-path-safety-prompt-grounding-governance` | `yes` | `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md` | 只有 future product scope 扩到 open-ended public input，或重新引入 state-changing / externally side-effectful action execution，并命中 `.planning/seeds/SEED-001-conditional-moderation-lane.md` / `.planning/seeds/SEED-002-conditional-hitl-approval-recovery.md` 的 trigger 条件时才恢复 |
| `campus services offline preparation hardening` | `campus-services-offline-preparation-hardening` | `yes` | `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md` | 只有在产品范围重新提升 `campus_services/*` offline-preparation quality hardening 优先级，或明确 admission 新的 bounded target 时才恢复 |
| `campus services / notices runtime admission` | `campus-services-notices-runtime-admission` | `yes` | `docs/plans/archive/completed/campus-services-notices-runtime-admission.md` | 只有在产品范围重新 admission 新的 runtime capability family、显式改写首发/后续 tool 边界，或需要重开 service / notice / contact / process runtime opening truth 时才恢复 |
| `notice consumption layer` | `notice-consumption-layer` | `yes` | `docs/plans/archive/completed/notice-consumption-layer.md` | 只有在 admitted notice source family 被显式改写、derived consumption unit schema 被显式改写、authority/completeness contract 被显式改写，或新的产品 adoption target family 被正式 admission 时才恢复 |
| `versioned history query foundation` | `versioned-history-query-foundation` | `yes` | `docs/plans/archive/completed/versioned-history-query-foundation.md` | 只有在 repo 重新 admission runtime-facing non-current query route contract、`app-api` live benchmark 正式承载 non-current `version_query`、或显式改写 `current / historical / as_of / compare` 的 request / resolution / retrieval / answer / eval truth 时才恢复 |

## Deferred

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `authenticated-notice file_release owner recovery` | `authenticated-notice-file-release-owner-recovery` | `yes` | `docs/plans/authenticated-notice-file-release-owner-recovery.md` | 只有在下一次 auth window 真正进入执行窗口，或产品范围重新提升 auth-dependent owner recovery 优先级时才恢复 |
| `authenticated-notice live portal / authenticated control-plane` | `authenticated-notice-live-portal-control-plane` | `yes` | `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md` | 只有在认证窗口恢复，或产品范围决定恢复 source-channel live portal scheduling / authenticated control-plane 时才恢复 |
| `restricted document rollout / verification` | `restricted-document-rollout-verification` | `yes` | `.planning/workstreams/restricted-document-rollout-verification/README.md` | 只有在产品范围决定打开 restricted surface 或推进 restricted collection rollout 时才恢复 |

## Backlog

| Workstream | Slug | Native Dir | Entry | Reopen Rule |
|------------|------|------------|-------|-------------|
| `official-web source channel / news opening` | `official-web-source-channel-news-opening` | `no` | `docs/plans/archive/historical/official-web-source-channel-news-opening.md` | 只有在产品范围重新提升新闻面 opening 优先级后才恢复 |
| `campus navigation rollout / place_card / map consumption` | `campus-navigation-rollout-map-consumption` | `no` | `docs/plans/archive/historical/campus-navigation-rollout-map-consumption.md` | 等待校园地图实际上线后再恢复 |

## Legacy / Follow-up References

这些条目继续保留为 repo 级参考，但当前不是原生 workstream：

- `docs/plans/archive/historical/protected-panel-requests-triage-table-redesign.md`
- `docs/plans/archive/superseded/golden-dataset-execution-plan.md`
- `docs/plans/archive/historical/legacy-acl-carrier-compatibility-sunset.md`
- `docs/plans/archive/historical/post-closeout-follow-up-execution-plan.md`

## Usage Rules

- 判断 repo 当前有哪些 workstreams、各自状态如何，先看这里
- 进入 native workstream 时，先打开对应 `.planning/workstreams/<slug>/README.md`
- 判断某条 workstream 的当前切片、blockers、verification，进入对应 `.planning/workstreams/<slug>/STATE.md`
- 判断某条 workstream 的固定顺序，进入对应 `.planning/workstreams/<slug>/ROADMAP.md`
- 判断某条 workstream 的范围、non-goals 与 success criteria，进入对应 `.planning/workstreams/<slug>/REQUIREMENTS.md`
- 判断当前谁认领了某条 workstream、handoff 是否 pending、某个本机会话是否仍持有 lease，使用 `uv run --all-packages python -m scripts.workstream_claim ...`；不要把这些运行时状态补写回 tracked planning 文档
- 需要历史 phase / milestone 叙事时，进入 `.planning/legacy-flat/`
