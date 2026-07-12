---
doc_type: architecture
truth_scope: ops
owner_boundary: execution-control
status: active
created: 2026-07-03
updated: 2026-07-06
---
# Learning Loop Architecture

## 文档边界

本文冻结线上使用如何进入持续优化闭环的系统架构口径。

它回答：

- 用户真实使用如何成为改进候选
- `stage_timing.v1`、safe fingerprint、反馈、RAG / tool 评分如何协作
- Langfuse、`packages/eval-langfuse`、`app-api` 和 Operator Console 各自承担什么
- 哪些数据不得进入 repo-owned projection、Operator Console 或自动训练链路

它不负责：

- HTTP response shape，见 `docs/contracts/app-api/`
- Langfuse runtime 字段 contract，见 `docs/contracts/langfuse-runtime.md`
- RAGAS lane、score registry 或 fixture 细节，见 `docs/reference/eval.md`
- Operator Console 布局，见 `docs/architecture/system/operator-console.md`
- release / staging 操作流程，见 `docs/runbooks/`

## Core Conclusion

`campus-agent` 的学习闭环目标态是 Langfuse-centered improvement loop：

```text
online usage
-> safe request projection / stage timing / safe fingerprints / feedback
-> candidate selector
-> Langfuse annotation / dataset / scores
-> improvement action attribution
-> offline eval / experiment / replay diff / regression
-> release
-> post-release metric comparison
```

`stage_timing.v1` 只回答“哪里慢”。学习闭环回答“哪里值得改、改什么、改完是否真的变好”。

`apps/app-api` 不是学习闭环数据仓库。它只保存产品运行和运维定位必须的 safe projection、
message feedback、request correlation 与 sink correlation。

Langfuse 是 LLM trace、annotation、dataset、score、experiment 和人工复核 workflow
平台。repo 自己拥有 safe projection、eval adapters、改进动作分类和 release 前验证规则。

## Runtime Signals

线上请求可以贡献以下安全信号：

- 显式反馈：helpful / unhelpful、reason code、用户修正或重新追问
- 交互信号：stop、cancel、retry、同会话重复提问、异常短 answer 或 no-answer
- 链路信号：`stage_timing.v1`、`stream.browser_ttft_ms`、`request.total_ms`、
  selected tool、tool fail-close reason、RAG empty / low evidence
- 质量信号：Ragas score、人工 annotation、Langfuse score、known badcase family
- 成本信号：model、provider、token usage、`agent.runtime_ms`、`tool.total_ms`

这些信号可以进入 repo-owned safe projection 或 Langfuse score / metadata。它们不能被
扩展成 raw prompt、raw answer、raw transcript、raw provider payload 或 raw sink payload
的 app-api 副本。

线上链路不保留 raw prompt、raw answer、raw provider payload、raw tool IO 或 raw
memory context。复现和评估使用批准的数据集、脱敏 Langfuse trace 投影、
`llm_io_fingerprint.v1` 与版本化配置，而不是生产 raw model-I/O replay。

## Candidate Selection

候选样本选择是离线改进 intake，不是在线回答链路的一部分。

默认进入候选池的情况：

- 用户给出 unhelpful 反馈
- 用户停止生成、取消后立即重试或同会话重复提出近似问题
- 请求超时、provider error、tool fail-close 或 finalization 失败
- RAG 分支返回空证据、低 grounding score 或低 Ragas score
- `stage_timing.v1` 字段超过
  `configs/runtime/latency-budgets.v1.json` 当前版本化 latency budget
- 人工 review 标记为 product / prompt / retrieval / tool / model 问题

候选选择只产生 review candidate 或 dataset candidate。它不能直接修改 prompt、索引、
tool schema、model 配置或训练数据。

Latency candidate evidence 只携带 canonical field、duration、threshold、severity、
budget version 和改进分类。它不携带 raw prompt、raw answer、raw provider payload、
raw Langfuse observation、raw OpenAI SDK trace 或 raw Temporal history。

Runtime-only latency candidate 的去重键固定为
`runtime_observation:<requestId>:<stageField>:<budgetVersion>`。这样同一请求的
TTFT、agent runtime、RAG lookup 等不同慢阶段不会被粗粒度 reason 合并；同一 budget
版本下的同一阶段也不会重复进入候选池。候选 metadata 可以携带 `stageField`、
`durationMs`、`budgetState` 与 `budgetVersion`，但不能携带 raw trace body 或 raw
model IO。

## Review And Dataset Flow

候选样本的默认处理路径是：

```text
candidate
-> Langfuse dataset candidate
-> human score / correction / category
-> accepted dataset item or rejected noise
-> experiment / Ragas scoring / regression comparison
```

当前 repo 已实现的 intake 是 `jobs/learning-loop-candidates`：

- 从 `chat.message_feedback` 与 `runtime.request_observability_fact` 做只读选择
- 只输出 safe candidate payload
- 可基于 `stage_timing.v1` 全 canonical 字段选择 runtime-only latency candidate
- dry-run 时不写 Langfuse
- publish 时通过 `packages/eval-langfuse` 写入 Langfuse dataset
  `online-answer/candidates`
- verify 时按 stable dataset item id 查询 Langfuse dataset，确认本批候选已经
  可被外部平台消费；缺失项 fail closed，不降级为 warning

Langfuse annotation queue 是可选人工复核 workflow。repo 当前不维护自研 annotation UI、
annotation queue sync、review manifest、quality dashboard 或 broad eval workspace。

生产 trace 可以成为 dataset item 的来源，但必须经过 explicit mapping、脱敏和字段 allowlist。
进入 dataset 不等于进入训练集；进入 dataset 也不等于 release verdict。

Badcase reproduction uses approved Langfuse datasets or trace projection plus
`llm_io_fingerprint.v1` identity. The fingerprint identifies prompt, provider,
model params, tool/runtime and context hashes without retaining rendered
messages, provider bodies, evidence bodies or memory text. Exact replay that
requires raw production model I/O is not an active capability.

## Improvement Actions

每个 accepted learning-loop finding 必须归因到一个主改进动作：

- `prompt_instruction_fix`
- `retrieval_source_fix`
- `tool_schema_or_description_fix`
- `tool_admission_or_routing_fix`
- `model_provider_or_latency_budget_fix`
- `product_expectation_or_ui_fix`

如果一个 finding 无法归入上述类别，应先作为 review noise 或 backlog discussion 处理，不要
新增临时类别、dashboard 字段或线上策略。

Fine-tuning 不是默认改进动作。只有当 eval、prompt、RAG / context、tool 和 provider /
latency 选择都无法解决已确认问题，并且有独立数据、隐私和验证 contract 时，才允许作为新
ADR 讨论。

## Release Validation

学习闭环不直接发布改动。改进动作必须先通过对应 owner 的验证：

- prompt 改动：offline dataset / experiment 对比，并检查 tool selection 与 grounding 回归
- retrieval/source 改动：索引、qrels、Ragas 和 source coverage 验证
- tool schema / routing 改动：contract test、tool admission test 和 workflow trace 验证
- model/provider/latency 改动：latency、cost、error rate 和 quality score 对比
- product UX 改动：前端验收与 feedback rate / retry rate 对比

发布后只比较 safe metric delta，例如 unhelpful rate、retry rate、tool fail-close rate、
RAG low-score rate、`stream.browser_ttft_ms`、`request.total_ms`、provider error rate 和
token cost。
不得用 raw trace body 或 raw LLM IO 作为 Operator Console 的发布证据。

## Operational Verification Boundary

候选选择、发布 payload 和发布后核验的 repeatable commands 归
`docs/runbooks/eval-operations-governance.md`。本文只保留学习闭环架构边界。

## Ownership Map

- `apps/agent-runtime`：将 allowlisted Agents SDK span facts 映射到 OTel，并产出 stage
  timing；不保存 repo-owned learning-loop state 或 raw model I/O。
- `apps/execution-control`：拥有 run / step / finalization projection、Temporal runtime
  correlation、tool outcome、安全 observability envelope 与 LLM I/O fingerprint。
- `apps/app-api`：保存 message feedback、request observability fact 与 Ops Index；不保存
  raw Langfuse / Sentry / Axiom payload 或 sink-specific trace projection。
- `packages/eval-langfuse`：拥有 Langfuse dataset / score config sync、safe Ragas projection、
  score publishing、learning-loop dataset candidate publishing 和 trace verification adapter。
- `packages/ragas-runner`：只运行上游 RAGAS scorer，不拥有候选选择、case truth、发布判定或
  Langfuse publishing。
- Langfuse：承载 trace、annotation、dataset、score、experiment 和 score analytics。
- Operator Console：只展示最小运行状态、request correlation 和 stage timing 摘要；不承载
  learning-loop review UI。

## Forbidden Shapes

- 不把 `app-api` 做成质量数据仓库。
- 不把 Operator Console 做成 Langfuse / Sentry / Axiom viewer。
- 不新增在线 quality / safety / cost / intent dashboard 作为学习闭环默认面。
- 不把 raw prompt、raw answer、raw transcript、raw provider response、raw retrieved snippet
  或 raw sink payload 写入 repo-owned projection。
- 不新增生产 raw model-I/O storage、Operator Console raw viewer 或 app-api sink mirror。
- 不从生产数据自动 fine-tune。
- 不让线上请求依赖 Langfuse availability。
- 不用 trace presence 代替 run lifecycle、terminal state、retry/cancel truth 或 release
  verdict。

## Related Documents

- `docs/architecture/system/langfuse.md`
- `docs/architecture/system/ops-observability.md`
- `docs/contracts/langfuse-runtime.md`
- `docs/reference/eval.md`
- `docs/reference/eval-map.md`
- `docs/product/langfuse-evals.md`
