---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-02
---

# 目标架构

## 文档边界

本文只负责描述 `campus-agent` 的 target architecture。

它回答的是：

- 长期要稳定成什么系统形态
- 哪些边界是长期不能退回的
- 当前架构向目标架构演进时，哪些原则必须保持不变

它不负责：

- 当前已开放 serving surface 的快照
- 某一轮 phase 的执行顺序
- 某个 app/package 的一次性实施细节

## 目标系统形态

`campus-agent` 的目标形态是：

- supervisor-led `hybrid orchestration`
- specialist 作为稳定能力边界
- shared app runtime 与 execution engine 分层
- 独立 ingestion / data plane
- 可替换 retrieval stack

长期主链路固定为：

`client/channel -> web surface -> shared app-api -> execution engine -> supervisor core -> specialist -> retrieval core -> evidence bundle -> supervisor synthesis -> response`

长期摄入链路固定为：

`crawler/job placeholder -> ingestion boundary -> raw/source-truth/projection/document/chunk/index`

## 长期硬约束

- 不退回 `campusRAG` 式的扁平 tool-adapter 顶层路径
- supervisor 保持唯一顶层协调入口，不演化成无中心 peer mesh
- runtime / transport 逻辑留在 `apps/*`
- stable capability boundary 留在 `packages/*`
- `packages/contracts` 不泄漏具体 runtime、vendor、infra 类型
- online query path 与 offline data plane 不混层
- serving surface 由 runtime profile / explicit policy 控制，而不是硬编码在 entry shell

## 长期产品/runtime 形态

- public 与 protected browser surface 可以是独立 Worker web surface
- shared `apps/app-api` 持续承接产品层 auth/session/principal、conversation、chat ingress、request projection 与 operator read surfaces
- `apps/supervisor-api` 持续只是 internal execution engine
- `apps/app-api` 已冻结为 Worker；这不反推 `apps/supervisor-api` 必须是同一 runtime

## 长期 execution / specialist 形态

- supervisor 负责 policy-driven orchestration、handoff、response finalization
- specialist 负责明确能力边界内的 planning / evidence consumption / answer shaping
- retrieval backend、vector infra、framework 选择隐藏在 specialist / retrieval boundary 之后
- 非 RAG capability 只要是长期稳定能力边界，也应作为 specialist 落地，而不是回退成 supervisor inline tool

## 长期 identity / authorization / memory 形态

长期真相层固定拆成：

- `verified identity`
- `profile memory`
- `session memory`
- `institutional knowledge`
- `authorization truth`

长期 owner 固定为：

- `apps/app-api` 拥有 canonical identity / authz / memory truth
- execution path 只消费最小 typed projection
- retrieval 只消费 authz projection carrier，不拥有最终 entitlement resolution
- memory 可以个性化 planning / wording，但不能提权

## 长期 retrieval / serving 形态

- retrieval 长期是 registry-backed、filter-first、evidence-oriented path
- current / historical / as-of / compare query 必须显式区分
- 版本选择发生在 retrieval 之前，不让回答层事后补救
- 多来源等价内容归并为逻辑 document version，而不是并列候选

## 长期 data-plane 形态

- raw asset、source truth、declared projection、document truth、chunk/index 持续分层
- source truth 是 canonical shared upstream
- 一份 source truth 可以 fan-out 到多份 collection / corpus
- 后续 replay / rebuild 从 source truth 继续，而不是返回 raw 重消费
- 对象存储始终被视为独立 `S3-compatible object storage` 边界

## 与当前架构的关系

当前架构是目标架构的受控子集，不是另一套方向。

当前尚未完成但属于目标架构一部分的能力包括：

- richer specialist families
- explicit historical / as-of / compare query
- restricted document rollout
- 更完整的 identity / authz / memory productization
- operator observability / audit control plane
- deploy-side observability hardening

这些能力的推进以对应 supporting architecture、ADR 与 active plans 为准。
