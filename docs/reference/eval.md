---
doc_type: reference
owner_boundary: packages/inspect-eval
status: active
---

# 评测

## 所有权

`packages/inspect-eval` 拥有用例加载、Inspect task/solver、确定性和语义 scorer、
原生评测日志。Inspect 只安排测试轮次，不执行生产 Agent 的内部阶段，不代理模型请求或工具调用。
Control/Runtime 负责未来的执行层评测入口；Runtime、Control、Memory、Search 继续拥有各自执行事实。

Ragas runner、旧评分命令和 Langfuse score 发布已退役，旧分数不迁移。`packages/eval-langfuse`
只保留在线 trace 校验；Langfuse 不是评测输入或分数存储。Docs/Notice 的索引制品专项评测继续由所属
Job 维护，不因 Agent 评分框架迁移而改变。

## 输入与输出

输入由调用方显式提供，不从普通 trace 反查正文。支持已有 `agent_product_eval_result.v3` 的原始产品
结果和 `agent_eval_sessions.v1` 会话结果；旧目标轮产物缺少 setup 回答时，完整会话维度未评分。
当前只读取显式保存的执行结果；Control/Runtime 直接执行入口尚未接入。
用例格式见[评测用例](./eval-cases.md)。

原始输入、对话和阶段材料保存在 Inspect sample 输入、store 和 transcript；metadata 用于标识和版本。
`.eval` 是唯一离线结果；报告命令只从该日志读取。日志可能包含评测正文，按调用方的数据边界保存，
不自动上传、归档或发布到 Langfuse，不写产品数据库。重新评分只消费保存的数据，不重跑产品。

## 分层评分

| 层级 | 判断 | 缺口处理 |
| --- | --- | --- |
| 会话 | 用户目标、纠正和跨轮约束 | 没有完整轮次时未评分 |
| 轮次 | 答案相关性、证据、引用、请求时间 | 缺少所需材料时未评分 |
| 阶段/尝试 | 完成状态、失败码、决定与证据保留 | 执行状态可判定；缺少实际输入输出时语义未评分 |
| 工具 | 调用次数、顺序、参数、结果与查询相关性 | 只评价实际保存的字段 |
| 耗时 | 总耗时、工具及阶段时长 | 目标来自 case；嵌套耗时不相加 |

确定性评分检查显式预期和执行事实；语义评分需要显式 grader。报告区分 `scored_pass`、`scored_fail`、
`unscored_missing_input`、`not_applicable` 和 `execution_error`，同时展示覆盖与失败定位。
最终回答成功不抹掉失败的中间尝试；裁判解释不是已经验证的根因。

## 当前覆盖

生产 `/steps` 已有 steps、attempts、results；新评测读取保留这些身份和受控字段，不只消费最后成功
attempt 的聚合答案。Search 查询和结果只使用已保存的投影。阶段输入正文、完整计划变化、Memory
工具正文和 Search 内部阶段尚未完整导出；明确标记缺失，不读取临时恢复载荷，也不承诺其长期可用。

离线结果不订阅回答 SSE，因此不以轮询首次观察时间冒充 TTFT；当前时间覆盖以
[阶段耗时合同](../contracts/stage-timing.md)和实际返回值为准。失败样本保留，已完成样本可由 Inspect
复用；评测重试不等于恢复产品 Workflow，不自动重试 Agent 行为错误以覆盖原失败。

## 依赖和运行

依赖声明不精确 pin，也不设置无依据上限；保留 `uv.lock` 并通过显式依赖升级更新解析版本。实际框架
版本进入评测日志。普通测试使用离线 fixture，不调用外部模型；真实产品执行与 grader 需显式运行。
Inspect 评分不自动决定发布，生产部署不安装此包。

## 相关文档

- [Inspect 操作手册](../runbooks/inspect.md)
- [评测用例](./eval-cases.md)
- [接入决定](../../.agents/notes/implemented/testing/2026-10-13-inspect-agent-evaluation.md)
