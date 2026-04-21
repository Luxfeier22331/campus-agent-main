---
doc_type: plan
status: superseded
created: 2026-04-02
updated: 2026-04-22
---

# Restricted Document Rollout And Verification

## 文档边界

本文固定 `restricted document rollout / verification` 这条 deferred workstream 的前向范围。

它负责：

- restricted collection / release posture rollout
- public chat、operator、service principal 的 allow/deny surface behavior
- 泄露防护验证与 rollout evidence

它不负责：

- 重开 identity / authorization foundation ownership 讨论
- 把 memory、legacy ACL sunset 或 operator observability expansion 混成同一条线
- 定义完整校园 IdP / directory 接入细节

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- 本文只保留 rollout order、surface contract 与最小验证口径
- active execution state 只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 merged truth 已固定的前提：

- canonical authz truth 归属 `apps/app-api`
- restricted retrieval 必须继续 candidate-pre-filter + fail-close
- restricted collections 当前仍以 `offline_preparation` 为主
- restricted query surface 尚未默认 reopened

## Execution Contract

restricted rollout 始终按一条 workstream 推进：

1. authorization and release posture truth
2. restricted collection and retrieval rollout
3. surface behavior rollout
4. verification and leakage hardening
5. planning closeout

固定原因：

- principal truth、collection posture、retrieval pre-filter 与 surface deny semantics 共享同一条 rollout truth
- 若拆 lane，容易留下半开 surface 或泄露面

## Fixed Rules

- restricted rollout 只在 canonical authz truth 已稳定的前提下推进
- restricted retrieval 不接受“先召回再回答层裁剪”
- rollout 期间优先 collection 级隔离；只有必须混存时才启用 document/chunk 级 visibility projection
- public chat、operator、service 的行为必须一并收口，不再分头漂移

## Forward Phases

### Phase A: Authorization And Release Posture Truth

目标：

- 固定参与 rollout 的 principal、collection 与 release posture

### Phase B: Restricted Collection And Retrieval Rollout

目标：

- 把 restricted posture 从 `offline_preparation` 推进到可验证 rollout

### Phase C: Surface Behavior Rollout

目标：

- 固定 public chat、operator、service 三类 surface 的 allow/deny contract

### Phase D: Verification And Leakage Hardening

目标：

- 用 allow/deny matrix、泄露防护回归与 rollout evidence 关闭验收口

### Phase E: Planning Closeout

目标：

- 把 rollout 结果与 residual deferred item 写回 planning

## Exclusions

固定不包含：

- policy admin UI
- 字段级内容打码
- 跨机构 federation rollout

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看对应 workstream `STATE.md`
3. 最后回到本文确认 rollout order 与 surface contract
