---
doc_type: requirements
status: active
created: 2026-04-22
updated: 2026-04-23
---

# Requirements: Eval

## Goal

为 `campus-agent` 建立独立、持久化的 shared eval workstream，
正式拥有 `packages/evals`、golden dataset governance、artifact contract、publish/backflow seam 与 release-gate automation，
避免 shared eval substrate 长期分散寄生在 retrieval、safety、operator 或单一 domain workstream 下。

## In Scope

- `packages/evals` 的 shared ownership
- deterministic gate 与 supplemental adapter 的分层规则
- coverage matrix / denominator truth、retrieval qrels、workflow/status case、deterministic answer truth 与 synthetic candidate intake 的共享治理
- live benchmark profile / artifact contract 的共享治理
- run / repair / accept / publish lifecycle
- `app-api` eval ingress、request correlation 与 operator publish 的 shared seam
- CI / release gate automation 的共享规则

## Non-goals

- handbook / curriculum / notice / navigation 的 domain truth 本体
- retrieval / tool / panel / supervisor 的业务实现
- operator observability panel 的 read-model ownership
- 把 supplemental judge / ragas 升级成 canonical merge gate
- 用单次 benchmark 结果改写 repo baseline

## Success Criteria

1. repo planning truth 中存在独立 `eval` workstream，明确拥有 shared eval substrate，而不是继续停留在 deferred reference plan 或与 `golden-dataset-execution-plan.md` 形成平行 owner。
2. `packages/evals` 的 shared runtime、artifact、repair、accept 与 publish 顺序被正式写成长期 phase，而不是散落在 feature closeout 中。
3. golden dataset governance 已被正式并入 `eval` workstream，但它只在采集内容补全后进入独立治理 phase；coverage matrix / denominator truth、retrieval qrels、workflow/status case、deterministic answer truth 与 synthetic candidate intake 的前向顺序被显式冻结。
4. shared case governance 与 domain truth owner 被显式分离：domain workstream 继续负责业务真相 authoring，`eval` 只拥有共享 case family、artifact family 与 acceptance governance。
5. operator publish/backflow 与 request correlation 被定义为 eval 的 shared seam，但不反向夺走 `app-api` 的 operator truth owner 身份。
6. CI / release gate automation 具备明确 owner，不再依赖临时会话或单条 feature workstream 的补充说明。

## Canonical Entry

- `.planning/workstreams/eval/README.md`
