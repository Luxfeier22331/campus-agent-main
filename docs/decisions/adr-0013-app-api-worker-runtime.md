---
doc_type: decision
decision_id: ADR-0013
status: accepted
created: 2026-03-28
updated: 2026-03-30
---
# ADR-0013 App API Worker Runtime

## 状态

Accepted on 2026-03-28.

## 背景

`ADR-0012` 已经冻结了新的产品边界：

- `apps/public-chat-web`
- `apps/protected-panel-web`
- shared `apps/app-api`
- `apps/execution-gateway` execution engine

但当时还没有关闭一个问题：

- `apps/app-api` 的 runtime 是否继续保持未冻结

如果这个问题继续悬空，后续实现很容易再次退化为：

- public chat / panel 各自长出独立后端
- `app-api` 先做成 Docker 服务，随后与 Worker web surfaces 形成额外部署裂缝
- `app-api` 为了实现便利重新吸收 orchestrator 语义

## 决策

后续长期形态固定采用：

1. `apps/app-api` 的 runtime 冻结为 Cloudflare Worker。
1. `apps/app-api` 默认保持 internal-only，不作为浏览器直连 public backend 暴露。
1. `apps/public-chat-web` 与 `apps/protected-panel-web` 通过内部 Worker runtime seam
   调用 `apps/app-api`。
1. `apps/app-api` 继续以模块化单体承接 auth/session/conversation、chat ingress、request
   ledger/projection input 与 operator query。
1. `apps/app-api` 内部继续保持 command/query 分离，不能退化为另一个 orchestrator。

## 约束

这项决策同时冻结以下约束：

- `apps/app-api` 不是 Docker-first 的默认长期形态
- browser 不直接调用 `apps/execution-gateway`
- panel 不直接查询数据库
- `apps/execution-gateway` 继续只是 execution engine
- `conversation/message` truth 不等于 operator request truth

## 结果

直接结果如下：

- 需要一份单独的 canonical architecture doc 描述 `app-api` 的 Worker runtime 与内部边界
- repo 入口文档与 planning 入口需要把 `app-api runtime = Worker` 作为 accepted truth
- legacy standalone public chat app 与 `apps/protected-internal-panel`
  应被表述为历史实现参考或 migration source，而不是 forward backend truth

## Complements

这项决策 complements：

- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
