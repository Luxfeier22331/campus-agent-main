---
doc_type: requirements
status: completed
created: 2026-04-19
updated: 2026-04-26
---

# Requirements: Authenticated Notice Live Portal Control Plane

## Goal

为 `authenticated_notice_portal` source channel 补齐 repo-native collector runtime、认证态 live capture、run ledger / artifact refs、live-historical reconcile 与 bounded operator control-plane。

## In Scope

- collector runtime / repo migration truth refresh
- auth bootstrap、live capture policy、targeted rerun、incremental sync 与 scheduling
- run ledger、artifact refs、policy snapshot、auth readiness
- live portal capture 与 historical export / bootstrap import reconcile
- `body-declared attachment` 与 `captured attachment entity/ref` 的显式区分，以及 declared-but-unmaterialized attachment mismatch 的 machine-readable taxonomy
- bounded source-channel operator APIs / control-plane

## Non-goals

- downstream `regulations/*` consumption
- target-side owner recovery
- repo-wide object storage 文件架构重写
- restricted query-serving、release publish 或 document center rollout

## Success Criteria

1. authenticated collector 的 repo-native runtime owner 与职责边界清晰且不漂移。
2. 认证态依赖成为显式 contract，而不是人工隐性前提。
3. live run、targeted rerun 与 source artifacts 能稳定回链到 run ledger 与 artifact refs。
4. `body-declared attachment`、`captured attachment ref` 与 declared-but-missing mismatch 能被显式区分，不再把“正文写了附件”静默降格成“无附件”。
5. live portal 与 historical lane 不再形成两套 source truth。
6. 最小 operator control-plane contract 成立，但不退化成对象存储浏览器或万能后台。

## Canonical Entry

- `.planning/workstreams/authenticated-notice-live-portal-control-plane/README.md`
