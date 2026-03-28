---
doc_type: plan
status: active
created: 2026-03-22
updated: 2026-03-25
---

# Supervisor 当期设计架构实施方案

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不扩大 supervisor 边界的前提下，将当前 `packages/supervisor-core` 从薄透传升级为单 specialist 的最小协调层，并保持 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core` 主链路稳定可测。

**Architecture:** 本次实施只落地 `single-specialist, policy-driven coordinator`。`apps/supervisor-api` 继续只负责 transport/auth/runtime boundary，`packages/supervisor-core` 负责 request framing、routing、policy、response shaping 和 audit projection，`packages/rag-specialist` 继续负责 retrieval-oriented specialist 逻辑。当前阶段只支持路由到 `rag-specialist`，并保持 supervisor 对用户回合的持续控制，不开放用户可见 handoff；但必须显式保留 routing decision 和 supervisor finalization，不允许继续围绕透传函数扩建。

**Tech Stack:** Python 3.12, uv workspace, dataclasses, Agno runtime boundary, unittest/pytest

---

## 摘要

当前 `packages/supervisor-core` 已有可运行 bootstrap，但主体逻辑仍然是：

- `SupervisorAgent.handle()` 直接转调 `specialist_delegate`
- audit 作为旁路记录存在
- request framing / routing / policy / response assembly 尚未成形

这份实施方案的目标不是新增功能面，而是把 supervisor 的职责位置固定住，让当前实现形态与长期架构保持一致。

本轮实施范围固定为：

- 当前主查询链路只支持 `rag-specialist`
- query-serving surface 由 runtime profile 控制；当前 query-enabled collection 是 `regulations/student_handbook` 与 `curriculum/curriculum_plan`
- 不修改 `packages/contracts` 的 schema 形状
- 不把 retrieval / ingestion / infra 细节拉回 supervisor
- 不把 transport/auth/runtime 逻辑回灌到 `supervisor-core`

## 文档定位

关系固定如下：

- `docs/architecture/long-term-architecture.md`
  定义整个仓库的长期架构边界
- `docs/architecture/supervisor-architecture.md`
  定义 supervisor 的长期架构与当期设计架构，以及当前 execution engine runtime / Agno 集成边界
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
  定义长期编排模式、specialist 准入与安全边界
- 本文
  只定义 supervisor 当期设计架构的实施顺序、文件落点和验收标准

## 完成定义

完成后以下条件必须同时成立：

- `packages/supervisor-core` 不再只由单个透传 `handle()` 支撑主流程
- request framing、routing、policy、response assembly、audit projection 各自有明确代码落点
- 当前依然只路由到 `rag-specialist`，但 route decision 已显式存在且 serving policy 由 runtime profile 决定
- 当前用户回合仍由 supervisor 持有，`rag-specialist` 不接管对话主导权
- `apps/supervisor-api` 不新增核心编排逻辑
- `tests/supervisor/` 能覆盖最小协调层行为
- `tests/api/` 能证明 API boundary 仍旧只负责 request construction 和 response projection

## 非目标

本轮明确不做：

- 第二个 specialist
- 多 specialist 串并行 workflow
- 用户可见 handoff
- supervisor 直接访问 retrieval-core / registry / object store
- 完整 session memory / HITL / approval flow
- 改写 `packages/contracts` schema
- 把 `apps/supervisor-api` 升级成更重的 runtime host

## 后续扩展前置条件

如果后续要新增 specialist、handoff 或 approval-required capability，至少需要先满足：

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md` 中的 specialist 准入和安全边界
- `docs/decisions/adr-0004-evaluation-metrics.md` 中的 workflow / safety / gate 指标覆盖

这些条件不属于当前实施范围，但当前设计必须为后续门禁保留正确位置。

## 当前实现盘点

当前已存在文件：

- `packages/supervisor-core/src/campus_supervisor_core/__init__.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `packages/supervisor-core/src/campus_supervisor_core/audit.py`
- `packages/supervisor-core/src/campus_supervisor_core/response.py`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
- `tests/supervisor/test_supervisor_core.py`
- `tests/api/test_supervisor_api.py`

当前主要缺口：

- supervisor 内部没有独立的 request/context 模型
- specialist routing 没有显式模块
- supervisor finalization/policy 没有显式模块
- `response.py` 只有最小 source 提取函数，尚未承担 response shaping 责任
- 测试主要证明“能调通”，还不足以证明“协调层已成立”

## 目标文件布局

建议收敛为以下最小布局：

- Modify: `packages/supervisor-core/src/campus_supervisor_core/__init__.py`
- Modify: `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- Modify: `packages/supervisor-core/src/campus_supervisor_core/response.py`
- Modify: `packages/supervisor-core/src/campus_supervisor_core/audit.py`
- Create: `packages/supervisor-core/src/campus_supervisor_core/context.py`
- Create: `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- Create: `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- Modify: `tests/supervisor/test_supervisor_core.py`
- Create: `tests/supervisor/test_supervisor_routing.py`
- Create: `tests/supervisor/test_supervisor_policy.py`
- Modify: `tests/api/test_supervisor_api.py`

如果实现过程中发现 `request.py` 比 `context.py` 更清晰，可以二选一，但不要同时保留两个近义模块。

## 实施顺序

### Task 1: 冻结当前行为并补第一批失败测试

**Files:**
- Modify: `tests/supervisor/test_supervisor_core.py`
- Create: `tests/supervisor/test_supervisor_routing.py`
- Create: `tests/supervisor/test_supervisor_policy.py`

**Implementation:**
- 先补测试，再动实现。
- 在 `test_supervisor_core.py` 中保留现有 smoke 覆盖，并新增以下意图：
  - supervisor 主流程不再依赖隐式透传
  - audit 仍只投影最小字段
  - `needs_clarification`、`no_answer`、`error` 都由 supervisor 最终收口
- 在 `test_supervisor_routing.py` 中新增：
  - 当前默认只选择 `rag-specialist`
  - 不允许在 supervisor 内静默放开未被 runtime profile 标记为 query-enabled 的 collection
- 在 `test_supervisor_policy.py` 中新增：
  - `completed` 保持完成
  - `needs_clarification` 保持 follow-up
  - `no_answer` 保持无答案语义
  - `error` 保持低置信度和 error payload

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py -q`

### Task 2: 引入 supervisor 内部上下文模型

**Files:**
- Create: `packages/supervisor-core/src/campus_supervisor_core/context.py`
- Modify: `tests/supervisor/test_supervisor_core.py`

**Implementation:**
- 新建 supervisor 内部上下文 dataclass，建议命名为 `SupervisorRequestContext`。
- 只承接 supervisor 需要的最小信息：
  - 原始 `SupervisorRequest`
  - `request_id`
  - `trace_id`
  - `user_id`
  - `conversation_id`
  - `primary_corpus`
  - `user_goal`
- 保持它是 contract 的只读投影，不重新定义对外 schema。
- 不在这里塞入 retrieval、runtime 或 transport 细节。

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py -q`

### Task 3: 引入显式 routing 模块

**Files:**
- Create: `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- Modify: `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- Modify: `tests/supervisor/test_supervisor_routing.py`

**Implementation:**
- 新建 `routing.py`，定义 phase-1 专用的 routing decision。
- 建议至少包含：
  - `SpecialistTarget` 或等价字面量
  - `RoutingDecision`
  - `route_request(context) -> RoutingDecision`
- 当前规则固定为：
  - query-serving 只允许 runtime profile 中已开放的 collection，当前为 `student_handbook` 与 `curriculum_plan`
  - 所有合法知识请求都路由到 `rag-specialist`
- 当前 delegation 保持为 bounded subtask delegation，不开放 user-visible handoff
- routing 模块的价值是固定“决策位置”，不是制造多余抽象。

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_routing.py -q`

### Task 4: 引入 supervisor finalization policy

**Files:**
- Create: `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- Modify: `tests/supervisor/test_supervisor_policy.py`

**Implementation:**
- 新建 `policy.py`，集中处理 specialist 结果后的 finalization。
- 建议至少包含：
  - `finalize_specialist_response(...)`
  - 或 `SupervisorDecisionPolicy`
- phase-1 规则应尽量简单且可预测：
  - `completed` -> 直接完成
  - `needs_clarification` -> 返回 follow-up
  - `no_answer` -> 保持无答案
  - `error` -> 原样保留错误语义
- 当前不要在 policy 中引入“智能复核”或再次 retrieval。

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_policy.py -q`

### Task 5: 升级 response 模块为正式 response assembly

**Files:**
- Modify: `packages/supervisor-core/src/campus_supervisor_core/response.py`
- Modify: `tests/supervisor/test_supervisor_core.py`

**Implementation:**
- 保留 `source_doc_ids_from_response(...)` 这类小工具，但让 `response.py` 承担正式 response assembly 角色。
- 建议增加：
  - `assemble_response(...)`
  - 或 `SupervisorResponseAssembler`
- 目标是把“最终对外响应由 supervisor 收口”的职责显式落地。
- 当前 response assembly 只做：
  - 状态稳定化
  - source doc ids 提取
  - 统一 follow-up / error / answer 返回口径
- 不在这里重写 specialist 的答案内容。

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py -q`

### Task 6: 重构 SupervisorAgent 主流程

**Files:**
- Modify: `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- Modify: `packages/supervisor-core/src/campus_supervisor_core/__init__.py`
- Modify: `tests/supervisor/test_supervisor_core.py`

**Implementation:**
- 将 `SupervisorAgent.handle()` 改成明确的 orchestration pipeline：
  1. 构建 `SupervisorRequestContext`
  2. 做 routing decision
  3. 委派给 specialist
  4. 执行 finalization policy
  5. 输出 assembled response
- 保持 `specialist_delegate` 可注入，方便测试。
- `handle_request()` 继续作为 package 入口，但只负责编排对象创建和 audit sink 调用。
- 不要把 audit、routing、policy 逻辑重新塞回 `__init__.py`。

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py -q`

### Task 7: 保持 audit projection 为最小稳定边界

**Files:**
- Modify: `packages/supervisor-core/src/campus_supervisor_core/audit.py`
- Modify: `tests/supervisor/test_supervisor_core.py`

**Implementation:**
- 保持最小审计字段不变：
  - `request_id`
  - `trace_id`
  - `user_id`
  - `status`
  - `source_doc_ids`
- 允许实现细节跟随 response assembly 调整，但不要扩大审计 schema。
- audit 继续是 supervisor 的责任，而不是 API boundary 或 specialist 的责任。

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py -q`

### Task 8: 校正 API boundary 测试，确保壳层不回灌编排逻辑

**Files:**
- Modify: `tests/api/test_supervisor_api.py`
- Optional Modify: `apps/supervisor-api/src/campus_supervisor_api/api.py`

**Implementation:**
- API 层只验证：
  - auth header -> `ActorContext`
  - trace header -> `TraceContext`
  - request payload -> `SupervisorRequest`
  - response -> HTTP JSON projection
- 如果当前 API 测试隐含了 supervisor 内部实现细节，应改成只断言 boundary 行为。
- 除非必要，不修改 `apps/supervisor-api` 主体代码；本轮核心不是 API 扩张。

**Verification:**
- `uv run --all-packages python -m pytest tests/api/test_supervisor_api.py -q`

### Task 9: 更新包级说明与文档引用

**Files:**
- Modify: `packages/supervisor-core/README.md`
- Optional Modify: `packages/supervisor-core/AGENTS.md`

**Implementation:**
- 将 `README.md` 从 “bootstrap” 表述更新为 “single-specialist coordinator skeleton” 或等价描述。
- 只有在局部规则明显落后于实现时，才补充 `AGENTS.md`；不要重复根文档内容。

**Verification:**
- 手工校对文档与代码职责是否一致

### Task 10: 执行仓库级验证

**Files:**
- No code changes

**Implementation:**
- 在局部测试通过后，执行仓库约定的验证命令。
- 如果全量失败，必须区分：
  - supervisor 改动引入的失败
  - 与当前任务无关的既有失败

**Verification:**
- `uv run --all-packages python -m pytest tests/supervisor/test_supervisor_core.py tests/supervisor/test_supervisor_routing.py tests/supervisor/test_supervisor_policy.py tests/api/test_supervisor_api.py -q`
- `uv run --all-packages python -m unittest discover -s tests -t .`

## 验收标准

完成后应能明确证明：

- supervisor 已具备 request framing、routing、policy、response assembly、audit projection 五个固定职责位置
- 当前实现仍只依赖一个 `rag-specialist`，但不再是结构性透传
- `apps/supervisor-api` 没有吸收核心编排逻辑
- `packages/contracts` 没有被 runtime / infra 类型污染
- 局部测试与仓库级验证命令可作为完成证据

## Deferred

以下内容明确延后，不在本方案内实现：

- 第二 specialist 接入
- supervisor 级 reflection / review loop
- 多 specialist DAG / workflow engine
- session memory 持久化
- 完整 routing matrix 与 policy engine
- HITL / approval flow
- runtime-level streaming 协议细化
