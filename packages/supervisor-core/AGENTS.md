# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `packages/supervisor-core` 的局部规则。

## Role

这个目录是 supervisor semantic coordination 层，不再拥有 deterministic runtime
policy。

- 消费 Go `apps/supervisor-api` 通过 bridge v4 投影的完整
  `SpecialistRequest`
- 负责 agent 委派、agent 结果 finalization 和 response assembly
- 当前默认 query-serving 主线仍是 `rag-agent`
- 当前接受的实现形态是 `Go runtime handoff -> Python semantic worker -> agent`
  的 private delegate path；不要把 routing / admission / tool policy 迁回 Python core

## Source Of Truth

修改本目录前，优先阅读：

- `../../AGENTS.md`
- `../../docs/architecture/target-architecture.md`
- `../../docs/architecture/system/execution-and-agents-architecture.md`
- `../../docs/reference/runtime-serving-and-index-terms.md`
- `../../docs/architecture/target-architecture.md`
- `src/campus_supervisor_core/__init__.py`
- `README.md`

## Owns

- Go preplanned `SpecialistRequest` 的 agent delegation
- agent 结果 finalization policy
- 组合 agent 结果并形成对外可消费的响应
- response-level observability projection

## Does Not Own

- capability / scope / version admission
- runtime intent frame、scope gate、policy gate 或 terminal envelope
- target/tool policy matrix
- deterministic structured payload planning
- bridge runtime decision parsing
- execution audit writing 或 lifecycle/cancel runtime counters
- retrieval 实现细节
- index 构建逻辑
- 向量数据库特定代码
- 对象存储、registry、Qdrant、MinIO 的直接接入
- HTTP transport、认证壳或 runtime 宿主逻辑

边界规则：

- `apps/supervisor-api` 负责 auth mapping、trace propagation、runtime admission、
  capability/scope/version guard、runtime policy、structured planner、terminal envelope、
  audit/metrics/readiness truth 与 full `SpecialistRequest` handoff projection
- `apps/supervisor-core-worker` 负责 private bridge parsing、prompt executor wiring
  和 minimal semantic worker readiness；不要把 public transport 或 runtime counters
  放进这里
- `packages/rag-agent` 负责 retrieval 导向的 agent 逻辑；不要在这里越级实现 agent 内部策略
- `packages/contracts` 是唯一共享 request/handoff/schema 边界；不要绕过 `SupervisorRequest`
  / `SpecialistRequest` / `SpecialistResponse` 私自发明并行接口

## Current Serving Constraints

- 当前默认 query-serving 已开放 `regulations/student_rules` 与
  `curriculum/curriculum_plan`，以及 `official_web/stable_reference`
- 当前默认 retrieval 问答主线仍然优先走 `rag-agent`，但 API shell 不应再把它写死成唯一 transport 构造
- 已冻结但未放开的 data-plane corpus 不能在 supervisor 内被静默放开为查询默认范围；范围真相以 runtime profile
  为准
- 不要直接拼接对象存储逻辑
- 不要越过 agent/retrieval 层访问 registry、Qdrant 或 MinIO
- 优先保持 `supervisor -> agent` handoff 清晰，而不是引入快捷路径

## Coordination Boundary

- 不要重新引入 Python `routing.py`、`intent.py`、`scope_policy.py`、`query_policy.py`、
  `validation.py`、`context.py` 或 `tool_policy.py`
- 如果新增逻辑，优先判断它是否属于 Go runtime control-plane；只有 semantic
  finalization / response assembly 才留在本 package
- 不要把 transport、auth、retrieval 细节补进 supervisor 作为临时方案
- 如果问题来自 handoff 或 orchestration 边界错误，优先修 supervisor 的编排边界，不要靠外围适配层兜底

## Answering And Verification

- 涉及 agent orchestration、委派策略、runtime 能力边界、当前官方建议时，先联网核对官方资料
- 只在需要当前官方结论时联网；本目录本地代码事实不联网
- 不要在纯评审或纯判断回答后默认追加实现建议，除非当前结论依赖后续动作

## Subagent Guidance

这个目录鼓励把工作按职责拆开处理，但不要共享写集。

- 可以把 `response shaping`、`audit fields`、`tests` 拆成独立子任务
- 不要把最终路由规则、agent 选择逻辑或接口取舍完全交给被委派的子任务；主代理保留最终编排责任
- 只有在 `contracts` 已冻结时，才并行推进 supervisor 内实现
- 若与 `packages/rag-agent` 或 `packages/contracts` 同时改动，先切清写集再并行

## Verification

优先使用这些命令验证本目录相关变更：

```bash
uv run --all-packages python -m unittest \
  tests.supervisor.supervisor_core_routing_suite \
  tests.supervisor.supervisor_core_specialist_policy_suite \
  tests.supervisor.supervisor_core_prompt_execution_suite \
  tests.supervisor.supervisor_core_observability_context_suite \
  tests.supervisor.test_supervisor_policy \
  tests.supervisor.test_supervisor_runtime_guardrails
```
