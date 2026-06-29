---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0027
status: accepted
created: 2026-04-05
updated: 2026-04-22
---
# ADR-0027 Navigation Tool And Spatial Truth

## 状态

Accepted on 2026-04-05.

## 背景

`campus-agent` 当前已经冻结了以下长期边界：

- `supervisor` 是唯一顶层协调入口
- deterministic tool 表示稳定能力边界；agent 只保留给显式 semantic agent-as-tool
- `apps/app-api` 是 canonical identity / authz / memory owner
- execution path 只消费 typed projection
- source truth 与 document / chunk / index truth 持续分层

但仓库仍缺一条导航 / wayfinding 的长期 accepted decision：

- 校园导航到底是不是独立 tool domain / execution boundary
- 校园空间真相属于哪一层
- 用户当前位置应该归属哪里
- 外部地图 provider 与瓦片地图应如何参与

如果这条边界不先冻结，后续实现很容易退化为：

- 把导航继续塞进 `knowledge` 或 supervisor inline tools
- 把高德或其他 provider response 直接当成 canonical campus truth
- 把当前位置写进 identity / authz / memory truth
- 把前端地图 SDK payload 或 provider ID 泄漏进 shared contracts

## 决策

### 决策 1：导航能力是独立 tool domain

长期上，校园导航 / wayfinding 作为独立 tool domain 存在，并以 `navigation` 进入
Execution Agent Layer / `ToolExecutionWorkflow` orchestration。

术语补充：

- 当前 accepted runtime / package / ADR label 继续是 `navigation`
- 这份 ADR 讨论的是 tool boundary；repo-wide rename 是否完成，以 current architecture 与
  active workstream closeout 为准

直接含义：

- 不把导航塞进 `knowledge`
- 不把导航退回成 supervisor inline tool
- supervisor 继续只负责 routing、gate、handoff、finalization
- 导航域的 planning / clarification / answer shaping 留在独立 tool boundary 内

### 决策 2：校园空间真相属于 repo-owned institutional knowledge 子域

长期上，校园导航相关 canonical truth 属于 `institutional knowledge` 的子域，而不是 app-owned
identity / memory truth。

建议的长期能力层包括：

- `campus_navigation/place_catalog`
- `campus_navigation/route_graph`

其中：

- `place_catalog` 表达 canonical place facts
- `route_graph` 表达 canonical connectivity / restriction / accessibility truth

直接含义：

- provider response 不拥有 campus spatial truth
- campus internal route correctness 由 repo-owned truth 决定
- spatial truth 继续走 source-truth-first data plane

### 决策 3：当前位置只能作为 request-scoped typed situational context

长期上，用户当前位置不属于：

- verified identity
- authorization truth
- profile memory
- canonical session memory

它只允许以 request-scoped typed situational context 进入 execution path。

直接含义：

- 不把 raw coordinates 写进 `ActorContext`
- 不把当前位置混进 `AuthorizationProjection`
- 不把当前位置静默持久化成长期 memory truth
- 如需跨轮承接，只允许使用 coarse place ref 或受控 typed slot

### 决策 4：地点 alias 采用 canonical entity resolution，而不是字符串替换

长期上，导航域 alias 的目标是 canonical entity。

当前至少接受以下 entity type：

- `place`
- `building`
- `entrance`
- `gate`
- `stop`

直接含义：

- alias resolution owner 在 `navigation`
- route executor 与 retrieval/facts 只消费 canonical entity truth
- 高歧义地点默认走 clarification-first

### 决策 5：瓦片地图是 runtime presentation concern，不是 canonical truth

长期上，产品 surface 可以接入瓦片地图或其他地图渲染能力。

但其角色固定为：

- presentation / interaction layer
- route overlay carrier
- location input aid

它不是：

- canonical spatial truth
- navigation tool boundary
- shared contract vocabulary

直接含义：

- 底图是否接入，不决定导航能力是否成立
- route correctness 不依赖前端地图 renderer
- browser map SDK type 不进入 `packages/contracts`

### 决策 6：外部地图 provider 只作为 adapter 参与

长期上，外部地图 provider 只允许作为 adapter 参与：

- geocode / reverse geocode
- POI search
- optional secondary route candidates
- optional off-campus extension

明确不做：

- 不把 provider route response 直接升级为 canonical campus route truth
- 不把 provider place schema 直接当 repo canonical place schema
- 不把 provider-specific IDs、SDK types、payload shapes 暴露进 shared contracts

### 决策 7：导航结果继续遵循 supervisor 终态合同

长期上，导航域结果继续使用 repo 现有的 supervisor-compatible terminal semantics：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `rejected`

直接含义：

- 无法安全解析起点/终点时，不得用 guessed route 代替 clarification
- 缺少可信 route truth 时，不得硬生成伪精确路径
- restricted spatial truth 未授权时必须 fail-closed

### 决策 8：导航交互采用 chat-first、map-enhanced、full-map-optional

长期上，导航的默认产品交互固定为：

- chatbot 内直接返回导航结果
- message 内可带 route card / mini-map / route preview
- 用户需要更强交互时，再进入同一产品内的 full-map view

明确不做：

- 不把独立地图站作为默认主路径
- 不把 chat 与地图拆成两套产品 truth / request flow
- 不让地图交互绕过 shared `app-api`、request correlation 与 audit / projection path

直接含义：

- 地图是 chat answer 的增强表达层
- full-map view 属于同一产品 surface 的扩展视图
- 是否存在 full-map view，不改变导航能力的 canonical execution chain

## 结果

直接结果如下：

- 需要新增一份 navigation supporting architecture 文档
- 后续 contract 设计应新增导航 tool 与 request-scoped situational context
- 后续 data-plane 设计应新增 campus spatial truth 的 source-truth / projection /
  artifact 方案
- 后续技术栈评估必须在上述目标和边界之后进行，而不是反向定义它们

## Related Docs

- `docs/architecture/domains/navigation/architecture.md`
- `docs/architecture/target.md`
- `docs/architecture/system/execution-agent-layer.md`
- `docs/architecture/system/product-runtime.md`
- `docs/architecture/system/identity-authz.md`
- `docs/architecture/system/data-plane.md`
- `docs/decisions/adr-0005-campus-services-taxonomy.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
