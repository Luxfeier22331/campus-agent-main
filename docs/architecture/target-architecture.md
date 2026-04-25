---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-25
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
- capability-neutral supervisor routing
- domain agent 作为稳定能力边界
- shared app runtime 与 execution engine 分层
- 独立 ingestion / data plane
- 可替换 retrieval stack
- eval-governed quality lifecycle
- planner-first `agentic retrieval` target，且仍保持 bounded campus scope

长期主链路固定为：

`client/channel -> web surface -> shared app-api surface policy/context
projection -> execution engine -> supervisor core admission/routing ->
capability agent -> family-specific planning/execution -> supervisor
finalization -> response`

长期摄入链路固定为：

`crawler/job placeholder -> ingestion boundary ->
raw/source-truth/projection/document/chunk/index`

## 长期硬约束

- 不退回 `campusRAG` 式的扁平 tool-adapter 顶层路径
- supervisor 保持唯一顶层协调入口，不演化成无中心 peer mesh
- `admission / guardrails` 与 `capability routing` 必须分层，不得重新混成一个模糊 knowledge gate
- runtime / transport 逻辑留在 `apps/*`
- stable capability boundary 留在 `packages/*`
- `packages/contracts` 不泄漏具体 runtime、vendor、infra 类型
- online query path 与 offline data plane 不混层
- serving surface 由 runtime profile / explicit policy 控制，而不是硬编码在 entry shell
- surface capability allowlist 由 shared `app-api` / product runtime policy
  拥有，而不是由 specialist 或 browser surface 自行推断
- 当前 target architecture 不默认接纳开放域 generalist / web capability 进入主 campus path
- `requested_scope` 只属于 knowledge-family path，不再作为所有 capability 共用的顶层默认字段
- retrieval plan 必须是 typed / observable artifact，而不是 prompt 内隐式黑盒
- planner 不能绕过 runtime profile、authz、source-trust 或 freshness gate
- admitted live retrieval 只能命中 repo-owned source channel，不得退化为 general web
  fallback

## 长期产品/runtime 形态

- public 与 protected browser surface 可以是独立 Worker web surface
- shared `apps/app-api` 持续承接产品层 auth/session/principal、conversation、chat
  ingress、request projection 与 operator read surfaces
- shared `apps/app-api` 长期同时拥有 surface capability policy 与最小 typed context
  projection
- `apps/supervisor-api` 持续只是 internal execution engine
- `apps/app-api` 已冻结为 Worker
- `apps/supervisor-api` 的部署 substrate 已冻结为 Docker-first internal execution service
- `apps/supervisor-api` 的 Docker substrate freeze 不反推单一 Python/HTTP framework、固定
  staging hostname，或 browser-facing exposure model
- Docker-side supervisor runtime 长期可以拆成 Go execution runtime control plane
  与 private semantic orchestration worker；Go 负责 deterministic runtime kernel，
  Python / package-owned agents 继续负责 semantic orchestration 与 reasoning

## 长期 execution / agent 形态

- `supervisor` 保持 invariant top-level role name；长期不引入 `supervisor-agent`
- repo-wide execution capability family 采用三层术语：
  - invariant role name
  - current-truth runtime / package / contract label
  - forward family label
- 当前 merged truth 已完成首轮 runtime/package label 收口：
  - `rag-agent`
  - `navigation-agent`
- 当前额外冻结的 forward family label 包括：
  - `campus-services-agent`
  - `notice-agent`
- 当长期新增稳定能力边界时，前向 family 命名默认采用 `<domain>-agent`
- 早期实验性的 `availability-specialist` 占位 capability 已退休；当前不再保留 `availability-agent`
  之类前向 alias
- 对已完成收口的 capability family，不再维护 `*-specialist` current-truth
  alias；后续也不得继续无规则地新增混合命名
- supervisor 负责 admission / guardrails、capability routing、handoff、response
  finalization
- supervisor 长期必须是 neutral capability router，而不是默认把所有请求先压成 `rag-agent`
- supervisor runtime control plane 长期由 Docker-side Go runtime 承接 deterministic
  execution lifecycle、cancel、timeout、queue、per-lane budget、runtime metrics、audit
  writer 与 fail-close envelope
- supervisor semantic orchestration 长期继续由 `packages/supervisor-core` 与 package-owned
  agent families 承接，不因 Go runtime 扩张而迁入 `apps/*`
- domain agent 负责明确能力边界内的 planning / evidence consumption / answer shaping
- `campus-services-agent` 长期承接只读校园服务结构化查询，包括 transport
  schedule、service status、service guide、temporary override 与 later-wave contact
  directory 等结构化校园服务真相；其中 `service_guide_lookup` 只回答办理指南、材料、
  入口说明、服务时间、联系方式与来源引用，不执行申请、预约、提交、代办、支付、工单创建或任何状态变更
- `notice-agent` 长期承接 notice discovery、canonical notice reading、historical
  downgrade 与 source-linked notice rendering
- `navigation-agent` 长期可消费 transport point refs / service point refs，但不拥有
  timetable truth 或 service-status truth；当前 runtime package 为
  `packages/navigation-agent`
- `rag-agent` 长期拆成 scope resolution、retrieval planning、answer
  synthesis、grounding validation 等内部角色；当前 runtime package 为 `packages/rag-agent`
- `retrieval-core` 长期负责 retrieval execution、rerank / merge / dedupe、query
  activity 与 candidate-set shaping
- retrieval backend、vector infra、framework 选择隐藏在 agent / retrieval boundary 之后
- 非 RAG capability 只要是长期稳定能力边界，也应作为稳定 domain family 落地，而不是回退成 supervisor inline
  tool
- `routing clarification` 与 `specialist clarification` 必须显式分层；前者由 supervisor
  拥有，后者由对应 specialist 拥有
- 对 `service_status_lookup`、`transport_schedule_lookup`、`service_guide_lookup`、
  `campus_notice_discover/get` 这类结构化 runtime capability，长期实现形态固定为
  `projection-backed internal query service + thin tool adapter + domain-agent`，而不是
  query-time raw source scan、browser/public API 直连，或 execution path 回调
  `app-api` loopback HTTP
- projection-backed internal query service 可优先采用 Go 实现，以降低 Docker-side runtime
  latency / memory cost；这不改变 domain-agent 的 capability owner 角色

如果未来产品明确接受开放域能力，也必须以独立 capability boundary 或独立 agent 接入，并拥有单独的
routing、policy、eval 与 observability 约束；它不是当前 campus path 的隐式 fallback。

## 长期 routing intent governance 形态

顶层 routing intent 长期必须是可版本化、可观测、可评测的 typed governance artifact，而不是
prompt 内部的隐式判断。

固定职责如下：

- `apps/app-api` 拥有 surface capability policy、conversation / session truth、operator
  review truth 与观测驱动治理 read model
- `apps/supervisor-api` 只拥有 deterministic execution admission、lane / opening gate、
  timeout / cancel / audit event 与 runtime metrics
- `packages/supervisor-core` 拥有 supervisor routing intent framing、routing clarification
  与 handoff semantics
- domain agent 只拥有已选定 capability family 内部的 specialist clarification 与执行语义
- `packages/evals` 拥有 intent truth dataset、runner、regression gate 与 observed-case
  promotion 协议

长期 intent policy / classifier 规则必须由 repo-owned artifact 治理，而不是散落在 runtime
源码中的匿名 signal list。该 artifact 至少固定 policy artifact schema version、runtime
policy version、classifier behavior version、intent schema version、case-set version、reason
code registry 与 signal group taxonomy。runtime 可以把 artifact 编译进部署镜像或按受控路径加载，
但缺失、版本漂移或结构不合法时必须 fail closed，不能静默回退到另一套未版本化规则。

长期 intent frame 至少应显式表达：

- admitted / inferred capability family
- task kind
- next action
- launch state
- risk level
- scope class / scope reason / policy reason
- missing slots
- routing confidence 或 ambiguity signal
- context resolution state
- classifier version
- intent schema version

其中 `intent_schema_version` 与 `intent_classifier_version` 必须分离：

- `intent_schema_version` 约束字段、枚举、reason code 与下游兼容性
- `intent_classifier_version` 约束 deterministic rule / model / resolver 的行为版本
- schema 的破坏性变更必须显式升 major，并同步 app-api、panel、eval 与 telemetry consumer
- classifier 的行为修复可以在兼容 schema 下独立迭代，但必须进入 eval regression 与
  observability rollup

上下文 follow-up 长期不作为 prompt side effect 处理，而由 supervisor-owned routing context
resolver 显式产出：

- `context_resolution_state`，例如 `not_follow_up`、`resolved`、`ambiguous`、
  `missing_context`
- `context_reference_type`，例如 previous goal、selected notice、curriculum slot、
  service temporal reference
- resolved slots
- missing slots
- ambiguity reason

resolver 只能消费 `apps/app-api` 投影出的最小 typed context，例如 session slot、selected notice
ref、recent goal summary 与 actor / profile projection；它不得反向读取 raw transcript、raw
session store 或 browser-local state。

长期 eval 必须把 routing intent 作为独立 workflow gate，而不是用最终回答质量间接覆盖。最小
suite family 固定为：

- `release_gate`：稳定 deterministic routing / guardrail baseline
- `context_follow_up`：多轮引用、slot 继承、缺上下文澄清与歧义处理
- `observed_regression`：从线上观测、人工复核、incident backfill 晋升的真实样本
- `version_compat`：schema / classifier version 与下游消费兼容性

长期 operator observability 必须能区分：

- routing 错误
- routing clarification 正确但 specialist 证据不足
- capability family 正确但 handoff / tool / source 执行失败
- schema / classifier version 变化导致的行为漂移

观测驱动治理链路固定为：

`request observability fact -> operator review / sampled grade -> intent case mining
-> packages/evals observed_regression -> release gate / version compat report`

该链路只能回流 sanitized routing / outcome / review summary，不得把 raw prompt、raw answer、
raw transcript、auth material 或 provider raw response 作为 panel truth 或 eval canonical
asset。

## 长期 eval / quality governance 形态

长期 eval 不是一次性 release checklist，而是围绕 production feedback 持续运行的质量治理
lifecycle。它必须和 runtime observability、operator review、golden truth 与 release gate
保持分层，但形成闭环。

固定 owner 如下：

- `packages/evals` 拥有 eval truth、case schema、runner、artifact、grader adapter、
  release gate 与 golden / regression admission lifecycle
- `apps/app-api` 拥有 internal eval ingress、request correlation、quality grade /
  trace backlink ingest 与 operator-facing projection，不拥有 golden truth
- `protected-panel-web` 只承担 operator review / triage UX；它可以发起受控 review
  action，但不决定 golden set truth、不生成 benchmark artifact
- `apps/supervisor-api` 与 domain agent 只产出 execution / trace / outcome
  facts，不写 eval truth
- OpenAI Evals / graders / tracing、RAGAS、Sentry、Axiom 等外部工具只能作为 grader、
  trace/debug sink 或 analysis input，不成为 repo canonical eval truth

长期 eval lifecycle 固定为：

`production request / incident / operator badcase ->
app-api operator candidate projection ->
eval-owned review / dedupe / admission ->
golden or observed regression case ->
deterministic + supplemental gate ->
accepted artifact ->
optional app-api grade / backlink publish ->
operator observability rollup`

其中：

- production aggregate、sampled grades、release-gate verdict 与 golden truth 不得混成一张表
- candidate review 必须记录 accept / reject / duplicate / deprecated / needs-info 等
  lifecycle decision，以及 reviewer、reason、source request 与 target suite
- accepted case 必须写入 repo-owned case fixture / artifact truth，而不是只留在 panel、
  sink dashboard 或临时 JSON
- release-gate artifact 必须保留 request correlation、runtime versions、case-set version、
  deterministic verdict、supplemental verdict 与 publish summary
- failed release gate 只能通过修复 runtime、修复 truth、或有审计记录的 case
  governance decision 关闭，不能在 panel 上直接 override

长期 suite family 固定分层：

- `smoke`
  - 小样本、快速、本地开发可跑，覆盖入口 contract 与高风险 happy path
- `release_gate`
  - 发布前 canonical denominator，覆盖已开放 serving surface 的核心成功 / fail-close /
    clarification / policy path
- `regression_locked`
  - 高风险历史回归，优先锁定 doc/version/source truth 与已修复 incident
- `observed_regression`
  - 从生产 badcase、operator review、incident backfill 与 sampled grade 晋升的真实样本
- `context_follow_up`
  - session slot、selected notice、recent goal、profile projection 与缺上下文澄清
- `version_compat`
  - intent schema、classifier、prompt、model、index、case-set 与 downstream consumer 兼容性
- `workflow_trace`
  - planner、handoff、tool call、guardrail、fail-close 与 structured runtime branch
    的 trace correctness

长期评分分层固定为：

- deterministic gate 是 canonical release verdict 的第一层，覆盖 status、routing、retrieval、
  citation、required facts、forbidden claims、policy / authz 与 fail-close
- supplemental graders 只能补充 grounding、relevance、tool / handoff semantics、
  workflow quality 与 human-calibrated rubric；它们是否 gating 由 repo-owned policy 决定
- human review 必须持续校准 automated grader，避免把 grader drift 反向写成 truth
- 对未开放 capability family，只允许评估 closed / candidate-only / clarification
  behavior；不能提前要求 answer quality gate

长期 eval artifact 与 observability 回流必须坚持 data minimization：

- eval artifact 可以保存 sanitized prompt summary、expected truth、observability summary、
  request / trace correlation、grader rationale summary 与 safe links
- eval artifact 不得保存 raw JWT、raw cookies、raw auth envelope、raw transcript、
  provider raw response、retrieval backend dump 或未经裁剪的 restricted document
  payload
- trace / grader tooling 的原始结果必须先经过 eval-owned projection，再进入
  `apps/app-api` 的 operator-facing grade / backlink ingest

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
- retrieval 只在 capability routing 已进入 knowledge-family path 后成立
- retrieval 长期目标是 planner-first、multi-step、bounded agentic retrieval path
- current / historical / as-of / compare query 必须显式区分
- 版本选择发生在 retrieval 之前，不让回答层事后补救
- 多来源等价内容归并为逻辑 document version，而不是并列候选
- candidate set 与最终 answer-bearing evidence 必须继续分层
- freshness-sensitive / live-assisted query 必须显式进入 planner
  branch，不得继续压扁成普通当前版本查询
- query activity、step outcome 与 supporting evidence summary 必须成为长期 observability
  truth

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
- governed routing intent schema / classifier versioning
- context follow-up resolver and routing clarification eval
- eval-owned candidate admission / observed regression lifecycle
- observability-driven intent review / production badcase backflow
- campus navigation / wayfinding
- planner-first agentic retrieval
- explicit historical / as-of / compare query
- freshness-sensitive / live-assisted retrieval
- restricted document rollout
- 更完整的 identity / authz / memory productization
- operator observability / audit control plane
- deploy-side observability hardening

这些能力的推进以对应 supporting architecture、ADR 与 active plans 为准。

与 capability-neutral routing、surface capability policy 与 clarification 分层相关的长期
supporting truth，统一看
`docs/architecture/system/capability-routing-and-admission-architecture.md`。

与 campus services structured runtime、projection-backed internal query service 与
opening gate 相关的长期 supporting truth，统一看
`docs/architecture/domains/campus-services/architecture.md`。
