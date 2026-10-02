# Agent Note: campus_search 检索词进入评测投影并移除 eval_safe_args

Status: implemented

## 背景

为支持对真实问题做端到端 Agent 评估，需要确认每次 `campus_search` 检索的意图。但
`agent_runtime_eval_projection.v5` 的 `tool_trajectory.v4` 只含 `tool_name`，看不到每次检索的
`search_query`/`search_goal`，无法验证 #562 类多维度问题"首轮检索是否覆盖全部维度"。

追踪链路确认：检索词由模型生成（`tool-function-schemas.v4.json`），agent-runtime 的 HTTP 响应已
携带完整 `arguments_json`（`http-response.ts:244`），execution-control 也已将 `search_query`
落库到 `agent_campus_search_diagnostics`。但写入 Temporal 步骤投影时（
`workflow_operation_activity.go`）只记录了 `arguments_json_sha256` 哈希，明文检索词未进入投影。

同时发现 `eval_safe_args` 机制是自 `ce6464435`（2026-07-11）引入的遗留物：它只为已退役的
`knowledge_search` 工具挑选分类枚举字段，且当前 16 个 routing case 全部是 `argument_mode:
"name_only"`，生产投影中 `eval_safe_args` 恒为空。该机制对"模型生成的检索词"套用"安全过滤"
白名单属于过度防御，无真实消费者。

## 决策

- 检索词平铺进投影：`campus_search` 的 `tool_calls[]` 直接携带当次 `search_query` 和
  `search_goal` 明文。写入端（`workflow_operation_activity.go`）从 `result.ArgumentsJSON` 提取，
  投影组装端（`execution_projection_handlers.go` 的 `projectedEvalToolCalls`）透传。这是模型生成
  的检索表达，不属于用户隐私数据，无需"安全"包装。
- `agent_runtime_eval_projection.v5` 原地演进，不升版本：当前无消费者依赖旧的空 `eval_safe_args`
  结构，v5 未冻结。
- 全链路移除 `eval_safe_args` 与 `argument_mode`：Go 投影、eval-langfuse（TS）的
  `ToolTrajectoryCall`/`AgentToolEvalCase`/评分、ragas-runner（Python）的样本合同、相关文档与测试
  同批删除。工具比对固定按工具名（即原 `name_only` 语义）。

## 未采用方案

- 升 `agent_runtime_eval_projection.v6` 保留 v5：v5 未冻结且无旧结构消费者，双版本 lockstep 是
  无谓成本。
- 复用 `eval_safe_args` 字段名放明文检索词：保留了已证伪的"safe"命名，语义不符。
- 放完整 `arguments` 对象：`campus_search` 当前只有 `search_query`/`search_goal` 两个参数，平铺
  两个命名字段已足够，不引入"所有参数都进投影"的语义。

## 后果

### 验证

- `go test ./...`（execution-control 全量）通过；`tool_trajectory_projection_test.go` 新增
  campus_search 平铺 `search_query`/`search_goal` 断言，personal_memory_recall 不暴露参数字段。
- 修复了引入的依赖边界违规：httpapi 不得导入 temporaladapter，改用 httpapi 本地常量
  `campusSearchToolName`（`TestInternalDependencyBoundaries` 通过）。
- `pnpm test --filter=eval-langfuse`（23 项）、`pnpm --dir packages/ragas-runner test:eval`
  （28 项）、`pnpm test --filter=campus-contracts`、`tsc --noEmit`、`docs:check` 全部通过。

### 影响面

- `cases.v1.json` 不再接受 `argument_mode` 字段；16 个既有 case 全部删除该字段（原本全为
  `name_only`）。
- ragas-runner agent 样本不再接受 `argument_mode`；指标名固定为 `tool_call_accuracy.name_only` /
  `tool_call_f1.name_only`。
- agent-runtime 无改动（响应本已携带 `arguments_json`）。

### 覆盖缺口

- 本变更只做到"能在轨迹里看到每次检索词"；尚未实现基于检索词或事实片段的自动评分（如
  `reference_fact_recall`）。事实命中评估留待后续按需扩展。
- `agent_campus_search_diagnostics` 表与投影都含检索词，两处语义一致但未做去重，属于不同
  消费者（诊断 vs 评测）各自的读取路径。
