# Agent Note: Inspect AI 多轮与阶段评测接入

Status: implemented

## 背景

用户需要逐轮、逐步骤和阶段评价会话效果，并定位失败。目标轮答案与工具名指标无法说明中间失败，
旧批次 runner 也会丢弃前置轮结果。用户确认完整替换 Ragas 和旧分数，首期提供保存结果评分；缺失阶段正文可后续补齐。生产架构以
[Agent 编排与 Memory 独立服务](../architecture/2026-10-10-agent-orchestration-memory-services.md)为准。

## 决策

`packages/inspect-eval` 拥有用例适配、Inspect scorer 与 `.eval` 日志。当前一个 sample 对应一个保存的
会话结果；Inspect 只评分，不触发产品执行。未来 live solver 通过 Control/Runtime eval ingress 读取执行周期，
不经过 App API 产品准入。

Inspect 不需要产品 Cookie、用户会话或 eval token。生产不依赖 Inspect，评测只消费执行层提供的受控事实；
未来 Control/Runtime 入口使用所属服务边界，不复制 App API 用户准入。真实请求时间取保存的执行事实。

控制面读取完整 step/attempt/result 投影，暴露结构化身份、失败、usage、时间和受控工具参数、归一化
检索结果；不依赖会清理的完整阶段载荷或原始 provider dump。普通线上 trace 不承载这些正文。
未发生的阶段不适用；发生但缺少输入的语义维度未评分；中间失败即使最终回答成功也保留定位。
Memory 追加独立于回答 Workflow，Search 内部耗时不能从工具总耗时推算。

确定性合同和语义裁判分别评分，并显示可评分覆盖与按会话类型、维度的汇总。次数、顺序和耗时阈值只
来自显式用例预期；原有目标轮 reference 不套给前置轮。裁判输入包括原始 prompt、前序对话、实际证据
和相关预期，裁判错误不丢弃产品结果。缺少完整 setup 结果的历史样本不评价完整会话。

Inspect `.eval` 是唯一离线评测结果。重新评分不执行产品。当前没有 live solver，也不生成产品请求、用户会话
或执行幂等身份；未来直接执行层入口接入后，再定义失败样本恢复和多轮身份。

移除 Ragas runner、旧评分命令与 Langfuse score 发布；旧分数不迁移。Langfuse 在线 trace 和校验独立保留。
本决策取代[评测数据与平台边界](./2026-08-21-eval-boundaries.md)的 Ragas/score 发布路径及
[评测指标](./2026-03-22-evaluation-metrics.md)的旧框架约定；其输入与在线 trace 分离原则继续有效。
检索参数的生产投影仍遵守[检索表达](../architecture/2026-09-30-campus-search-query-in-eval-projection.md)，
trace 正文边界仍由[调用链数据](../architecture/2026-07-15-langfuse-trace-data.md)维护。

依赖声明不精确 pin，也不添加无依据版本上限；提交正常 `uv.lock`，通过显式升级与相关测试接收更新，
不在运行时隐式升级。日志记录实际框架版本，结果比较不依赖长期冻结版本。

## 未采用方案

只评目标轮改动最少，但不能满足多轮和阶段归因。包装旧整批命令也不能恢复丢弃的 setup 与失败材料。

保留两套评分框架便于渐进比较，但用户已确认丢弃旧分数，双栈没有当前消费者。Langfuse score 发布可提供
线上关联，但新需求以 Inspect 原生日志查看和重新评分为准，不维护第二份结果。

Agent Bridge 能捕获框架内模型轨迹，但会改变生产调用路径；本接入只消费执行层事实。直接从普通
trace 取正文也不可行：当前 trace 不含正文，且不能保证完整模型/工具调用链。

## 后果

离线结果和未来真实执行将拥有统一评分入口，报告可区分答案效果、中间执行失败、评分器错误和缺失输入。无部署或
provider 访问时，可通过 MockTransport 与真实 Inspect 日志验证协议、恢复、重新评分和多轮顺序，不能据此
声称已验证 staging 的模型效果。

完整阶段输入输出、计划变化、Memory 内容及 Search 内部诊断仍是输入缺口，属于各事实 owner 后续补齐；
缺口不阻断现有可评分部分。最终答案正确不能证明每一步正确；裁判结论需要带预期样例校准，不能直接当作
根因证明。阶段、工具与等待时间可能重叠，报告不把嵌套耗时相加成总耗时。

当前操作与字段见[评测参考](../../../../docs/reference/eval.md)。
