# Agent Note: 在线回答双流式模型消费协议与默认非流式

Status: implemented

## 背景

在线回答链路（`campus-web → app-api → execution-control → agent-runtime → 模型 gateway`）的 solve/execute_step 步骤此前硬编码 `Stream: true`，走 Gemini `streamGenerateContent`。实测当前模型 gateway（`mucwiki-edge.link`）在「流式 + `functionDeclarations`（函数工具声明）」组合上稳定返回 `event:error` "invalid response"，导致带校园检索工具的 solve 步骤必失败（浏览器侧表现为 `run_failed`），在线回答近乎不可用。

逐字段直连 gateway 复现定位：单独 `responseJsonSchema` 或单独 `googleSearch` 的流式正常，**只要带 `functionDeclarations` 流式即报错**；而**非流式 `generateContent` 带完全相同的工具声明返回 200 正常**。缺陷与模型版本（gemini-3.6/3.7-flash）无关，是 gateway 对流式函数工具的支持缺陷。

非流式 solve 功能与流式等价：`solve_outcome`（answer/plan）、证据链、usage、工具循环均可用；execution-control 的 recovery synthesize 本就是"非流式拿全文再投影"的日常路径；前端终态 `request.completed` 用 canonical 全文渲染，不依赖增量 `answer.delta`。

## 决策

让 solve/execute_step 的模型消费协议同时支持流式与非流式、可切换，当前默认非流式，供应商修复后评估切回。

- 新增进程级开关 `EXECUTION_CONTROL_ANSWER_TRANSPORT`（取值 `stream`/`buffered`，默认 `buffered`），由 `execution-control` config 读取。任何非 `stream` 值（含缺省、非法值）一律归一为 `buffered`，避免误开流式复现缺陷。
- `streamModelAnswers()` 统一判定，solve/execute_step 的 `Stream` 标志由硬编码 `true` 改为读该开关。synthesize 的 `Stream: !BufferAnswer`（recovery 既有逻辑）不动。
- 非流式 solve 返回完整 `FinalOutput` 后，在 activity 内复用 `ProjectWorkflowAnswerDelta`（单 chunk）+ `ProjectWorkflowAnswerCompleted` 投影全文并置 `AnswerStarted=true`，使浏览器可见事件序列与流式同构（answer-started → 单个 answer.delta(全文) → answer-completed → request.completed），前端零改动。
- 放开 `ValidateWorkflowOperationRequest` 中 solve 必须 `Stream: true` 的硬校验，保留 identity/budget 校验；execute_step 本就不强制流式。

切回流式 = 改环境变量重启进程，无代码改动；流式代码路径（`ConsumeWorkflowRuntimeStream`、agent-runtime streaming runner）完整保留。

## 未采用方案

- **agent-runtime 内部流式→非流式自动回退（伪流式重放）**：需在 agent-runtime 把完整 answer 切成伪 `answer_delta` 满足 execution-control 的流式状态机，并引入回退白名单、单次上限、首 delta 前窗口三重约束，复杂度和双重模型调用风险都高于直接默认非流式。且该 UX（边生成边显示）当前因缺陷从未工作，"保住流式"的前提不成立。
- **execution-control 把全文按节奏切成多个伪 delta 投影**：多一层切块逻辑与投影写库，浏览器"逐字"但首段仍要等完整响应，收益不抵复杂度。
- **只做配置开关不做非流式投影**：非流式 solve 不发 `answer_delta`，浏览器只能等终态 canonical 才看到全文；补上单 delta 投影后事件序列与流式一致，前端无需任何改动。

## 后果

在线回答从「solve 必失败」恢复为可用；代价是 solve/execute_step 暂失"边生成边显示"，浏览器为"等待→整段出现"。synthesize 仍按原逻辑可能流式（其请求体未触发缺陷，实测正常出多 delta）。

验证：config 开关三态（缺省/buffered/stream/非法值）、`streamModelAnswers` 开关映射、`CallWorkflowOperationRuntime` 的 Stream 透传与非流式整 body 读取均有单测；execution-control 全量 `go test ./...` 与 `go vet` 通过。真实链路（保持 gateway 缺陷、默认 buffered）实测：solve `run_failed` 转为 `request.completed`、单 `answer.delta` 落地完整回答；plan 分支（solve→executor×2→replan→synthesize）全步骤 completed。开关切回 `stream` 后 solve 回流式（本次实测亦 completed，印证 gateway 缺陷间歇性，更凸显默认 buffered 消除不确定性的价值）。

删除条件：gateway 修复 `streamGenerateContent` 对 `functionDeclarations` 的支持后，将默认改为 `stream` 或直接移除开关与 buffered 投影分支，恢复 solve 必须流式的硬校验。

已知边界：非流式 solve 的单 delta 投影在 `ValidateOperationOutputFields` 通过后、`ProjectWorkflowToolResults` 之前执行；`AnswerStarted=true` 与流式"已发 delta"语义一致，下游 recovery 的 `BufferAnswer: solveResult.AnswerStarted` 行为不变。gateway 缺陷间歇性意味着 `stream` 模式下偶发成功，不改变默认 `buffered` 的决策。
