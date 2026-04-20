---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-21
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
- domain agent（当前 merged-truth package 仍可能保留 `*-specialist` 命名）作为稳定能力边界
- shared app runtime 与 execution engine 分层
- 独立 ingestion / data plane
- 可替换 retrieval stack
- planner-first `agentic retrieval` target，且仍保持 bounded campus scope

长期主链路固定为：

`client/channel -> web surface -> shared app-api -> execution engine -> supervisor core -> specialist planner -> retrieval plan -> retrieval core executor -> supporting evidence -> specialist synthesis -> supervisor finalization -> response`

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
- 当前 target architecture 不默认接纳开放域 generalist / web capability 进入主 campus path
- retrieval plan 必须是 typed / observable artifact，而不是 prompt 内隐式黑盒
- planner 不能绕过 runtime profile、authz、source-trust 或 freshness gate
- admitted live retrieval 只能命中 repo-owned source channel，不得退化为 general web fallback

## 长期产品/runtime 形态

- public 与 protected browser surface 可以是独立 Worker web surface
- shared `apps/app-api` 持续承接产品层 auth/session/principal、conversation、chat ingress、request projection 与 operator read surfaces
- `apps/supervisor-api` 持续只是 internal execution engine
- `apps/app-api` 已冻结为 Worker；这不反推 `apps/supervisor-api` 必须是同一 runtime

## 长期 execution / specialist 形态

- `supervisor` 保持 invariant top-level role name；长期不引入 `supervisor-agent`
- repo-wide execution capability family 采用三层术语：
  - invariant role name
  - current-truth runtime / package / contract label
  - forward family label
- 当前 merged truth 仍保留 `rag-specialist`、`navigation-specialist` 等 current-truth label；当长期新增稳定能力边界时，前向 family 命名默认采用 `<domain>-agent`
- 已冻结的 forward family mapping 包括：
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`
  - `campus-services-agent`
  - `notice-agent`
- 早期实验性的 `availability-specialist` 占位 capability 已退休；当前不再保留 `availability-agent` 之类前向 alias
- 在 repo-wide family convergence 真正落地前，current-truth `*-specialist` label 与 target-side `*-agent` family label 可以短期并存；但不得继续无规则地新增混合命名
- supervisor 负责 policy-driven orchestration、handoff、response finalization
- domain agent / specialist 负责明确能力边界内的 planning / evidence consumption / answer shaping
- `campus-services-agent` 长期承接 transport schedule、service status、temporary override 等结构化校园服务真相
- `notice-agent` 长期承接 notice discovery、canonical notice reading、historical downgrade 与 source-linked notice rendering
- `navigation-agent` 长期可消费 transport point refs / service point refs，但不拥有 timetable truth 或 service-status truth；在真正迁移前，current runtime package 仍是 `packages/navigation-specialist`
- `rag-agent` 长期拆成 scope resolution、retrieval planning、answer synthesis、grounding validation 等内部角色；在真正迁移前，current runtime package 仍是 `packages/rag-specialist`
- `retrieval-core` 长期负责 retrieval execution、rerank / merge / dedupe、query activity 与 candidate-set shaping
- retrieval backend、vector infra、framework 选择隐藏在 specialist / retrieval boundary 之后
- 非 RAG capability 只要是长期稳定能力边界，也应作为稳定 domain family 落地，而不是回退成 supervisor inline tool
- 对 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover/get` 这类结构化 runtime capability，长期实现形态固定为 `projection-backed internal query service + thin tool adapter + domain-agent`，而不是 query-time raw source scan、browser/public API 直连，或 execution path 回调 `app-api` loopback HTTP

如果未来产品明确接受开放域能力，也必须以独立 capability boundary 或独立 specialist 接入，并拥有单独的 routing、policy、eval 与 observability 约束；它不是当前 campus path 的隐式 fallback。

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
- retrieval 长期目标是 planner-first、multi-step、bounded agentic retrieval path
- current / historical / as-of / compare query 必须显式区分
- 版本选择发生在 retrieval 之前，不让回答层事后补救
- 多来源等价内容归并为逻辑 document version，而不是并列候选
- candidate set 与最终 answer-bearing evidence 必须继续分层
- freshness-sensitive / live-assisted query 必须显式进入 planner branch，不得继续压扁成普通当前版本查询
- query activity、step outcome 与 supporting evidence summary 必须成为长期 observability truth

## 长期 data-plane 形态

- raw asset、source truth、declared projection、document truth、chunk/index 持续分层
- source truth 是 canonical shared upstream
- 一份 source truth 可以 fan-out 到多份 collection / corpus
- 后续 replay / rebuild 从 source truth 继续，而不是返回 raw 重消费
- 对象存储始终被视为独立 `S3-compatible object storage` 边界

## 与当前架构的关系

当前架构是目标架构的受控子集，不是另一套方向。

当前尚未完成但属于目标架构一部分的能力包括：

- richer execution capability families
- campus navigation / wayfinding
- planner-first agentic retrieval
- explicit historical / as-of / compare query
- freshness-sensitive / live-assisted retrieval
- restricted document rollout
- 更完整的 identity / authz / memory productization
- operator observability / audit control plane
- deploy-side observability hardening

这些能力的推进以对应 supporting architecture、ADR 与 active plans 为准。
