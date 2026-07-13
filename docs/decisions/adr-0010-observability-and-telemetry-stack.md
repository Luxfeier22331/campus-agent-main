---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0010
status: accepted
created: 2026-03-27
updated: 2026-07-12
partially_superseded_by: ADR-0072
---
# ADR-0010 观测与遥测栈决策

适用范围：`campus-agent` v2 的应用错误监控、trace、AI 调用观测、结构化运行事件、告警与数据最小化边界

## 当前边界说明

本文的 OpenTelemetry-first / Axiom / Sentry 分层决策仍有效。背景中涉及旧 Python
supervisor、旧 Python knowledge/retrieval 在线链路的 runtime 拆分已由
ADR-0048 与 `python-boundaries` 局部 supersede；当前 online execution /
retrieval telemetry 由 `apps/execution-control`、Temporal、`agent-runtime` 与 typed
activity workers 产出。

本文首版基线中的 Operator Console request projection 已由 ADR-0072 取代；当前请求排查由
self-hosted Ops Web 读取受限 owner tables。OpenTelemetry-first、Sentry、Axiom 与 Langfuse
的分层决策继续有效。

## 背景

`campus-agent` 的长期运行形态不是单一 HTTP 服务，而是至少包含：

- `apps/execution-control` 入口边界
- `apps/execution-control` execution runtime、runtime policy、finalization 与审计投影
- `agent-runtime` OpenAI Agents SDK primary/Knowledge Agent execution surface
- `apps/execution-control` internal `knowledge_search`、evidence/source validation
  与 four-phase Temporal projection chain
- `apps/ingestion-control` / `packages/ingestion-core` 的离线摄入链路
- 后续 Cloudflare public entry、consumer app 与其他 agent 的运行时壳

因此系统需要同时满足两类不同的运行诉求：

- 开发与故障调试 需要看 exception、slow request、downstream failure、trace 断点、AI 调用异常
- 运行事件分析 需要看 retrieval 命中、no-answer、clarification、ACL 决策、token 成本、chunk / index
  / rebuild 结果等高体量结构化事件

如果只用单一产品承担这两类职责，长期容易出现以下问题：

- 错误调试体验和高吞吐事件分析互相牵制
- schema 与 retention 混乱
- 日志噪音与成本失控
- prompt、chunk 正文和用户输入被过量落盘

## 决策 1：长期采用 `OpenTelemetry-first` 的观测入口

结论：

- 长期遥测入口采用 `OpenTelemetry-first`
- 运行时代码优先产出结构化 log、span、metric 与统一 trace / request 关联字段
- 不把任何单一厂商 SDK 的事件模型视为仓库级 canonical telemetry schema

原因：

- `campus-agent` 是多 runtime、多边界系统，需要保留 vendor 可替换性
- `OpenTelemetry` 允许在统一入口下做 redaction、sampling、routing 与 sink 分流
- 这比直接把业务语义绑定到某一家产品字段模型更符合当前仓库的边界原则

## 决策 2：`Axiom` 负责高吞吐结构化事件与运行分析

结论：

- `Axiom` 作为高吞吐结构化运行事件的主分析面
- 默认承接 log/event-heavy 的 RAG 与 ingestion 事件，不承担唯一错误调试入口

默认进入 `Axiom` 的事件包括：

- retrieval events
  - query rewrite / HyDE / routing 决策
  - dense / sparse / fusion / rerank 参数与结果摘要
  - evidence source locator、registry backlink、citation 统计
- generation events
  - `completed` / `needs_clarification` / `no_answer` / `error`
  - answer confidence、no-answer reason、clarification reason
  - token usage、latency、cost attribution
- ingestion events
  - raw asset / version / parser / OCR model
  - chunk count、embedding batch、index write、rebuild / replay 结果
- governance events
  - ACL / scope / version filtering 决策
  - cache hit / miss
  - release-gate 与 eval 结果摘要

原因：

- 这类数据天然偏高吞吐、结构化、需要长时间聚合分析
- 后续 dashboard、trend、badcase slicing、corpus / collection 对比更贴近 `Axiom` 的使用形态

## 决策 3：`Sentry` 负责错误、trace 与 AI 调用调试

结论：

- `Sentry` 作为应用错误监控、request trace、dependency failure 与 AI 调用调试的主面板
- 不把 `Sentry` 当作唯一长期事件仓

默认进入 `Sentry` 的信息包括：

- `apps/execution-control`、worker、consumer app 的未捕获异常与错误聚合
- 慢请求、timeout、retry、外部依赖失败
- 关键 runtime trace 与 downstream span
- AI / LLM / agent 相关 span、token 使用与调用失败

原因：

- `Sentry` 在 exception、performance tracing 与开发态故障定位上更强
- AI / LLM / agent 调试更适合与 trace、error、release、alert 放在同一调试面

## 决策 4：`OpenTelemetry Collector` 作为 redaction、sampling 与 fan-out seam

结论：

- 默认通过 `OpenTelemetry Collector` 做 routing seam，而不是由业务代码直接双写所有 sink
- redaction、sampling、fan-out、字段裁剪优先放在 Collector 或统一 telemetry adapter 层

原因：

- 这样可以避免在 supervisor、agent、ingestion 各层复制厂商逻辑
- 方便在 `Axiom` 与 `Sentry` 之间执行不同的采样和字段保留策略
- 后续若替换 sink，不需要回改核心业务语义

## 决策 5：观测默认遵循数据最小化与 fail-closed 原则

结论：

- 默认不把完整 prompt、chunk 正文、原始 OCR 文本、用户敏感输入直接发送到 `Axiom` 或 `Sentry`
- 优先发送：
  - `trace_id`
  - `request_id`
  - `conversation_id`
  - `query_id`
  - `document_id` / `version_id` / `chunk_id`
  - status、route、latency、token、cost、reason code、count summary

只有在明确需要的受控调试场景下，才允许额外发送脱敏后的摘要字段。

最低要求：

- PII、secret、token、cookie、access envelope、raw auth material 不得直接落盘
- ACL / version / route / source locator 等治理字段必须可追踪
- redaction 配置应先于 production sink 开启
- 如果后续需要 operator-facing request list/detail，必须通过 runtime-owned projection/read
  API 提供；`Axiom`、`Sentry` 与 raw audit log 都不是 canonical panel read model

## 决策 6：identity / memory / personalization telemetry 也必须最小化

后续当系统引入 canonical identity、profile memory、session memory 与 personalization
后，长期默认允许观测的字段仍应保持最小化。

长期默认允许的结构化字段包括：

- `actor_id_hash`
- actor claims version / snapshot id
- `personalization_mode`
- memory item id / hash
- memory source type
- clarification reason
- ACL filter summary

长期默认不允许直接进入 sink 的内容包括：

- raw JWT、raw access envelope、raw auth header
- raw long-term memory
- 未脱敏的 personal conversation text
- 用户私密笔记、profile 原文、自由文本画像摘要

这些规则同样适用于 `Axiom`、`Sentry` 与后续其他 sink；Collector / telemetry adapter 应在 sink 前完成
redaction 与字段裁剪。

## 不冻结的内容

本 ADR 不冻结以下内容：

- 某条 dashboard 的精确布局
- 某个环境的 retention 天数
- alert threshold、sampling ratio 或 cost budget 的具体数值
- 某个 SDK 的细节 API
- 某轮迭代是否已经把所有 runtime 都接入同一 collector

这些内容属于实施与运行时策略，应进入后续配置、implementation doc 或 phase work。

## 后果

直接结果：

- 后续 observability 接入应以 `OTel schema -> Collector -> sink` 为默认方向
- `Axiom` 与 `Sentry` 采用职责拆分，而不是互相替代
- Phase 5 及后续运行时工作应把 audit / trace / telemetry 字段统一到同一 request identity 模型下

## 第一版落地基线

本 ADR 接受时记录的首版落地基线固定为：

- `apps/app-api` 接入 `Sentry` 的 Worker `fetch` 与 `scheduled`，并作为当前 product
  topology 的主 observability owner
- `apps/campus-web` 接入 `Sentry` 的 Worker shell，并向 `app-api` 透传
  `x-trace-id`、`sentry-trace`、`baggage`
- `apps/operator-console-web` 接入 `Sentry` 的 Worker shell，并向 `app-api` 透传
  `x-trace-id`、`sentry-trace`、`baggage`
- `Axiom` 当前只在 `apps/app-api` 落地最小结构化运行事件；实现形态允许先使用 Worker-local REST ingest
  adapter，但不改变长期 `OTel -> Collector -> sink` 方向

这一版不改变 canonical truth：

- panel `Requests` 仍然只读取 `operator.request_projection`
- `Axiom`、`Sentry`、raw audit log、trace dump 都不是 panel read model

明确不做：

- 不把 `Sentry` 当作唯一高吞吐 RAG 事件仓
- 不把 `Axiom` 当作唯一错误调试面
- 不在没有 redaction / minimization 的情况下直传全文 prompt 与 chunk 正文
- 不让 vendor-specific telemetry schema 反向定义 `packages/contracts`

## 相关文档

- `docs/architecture/target.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
