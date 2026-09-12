---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0076
status: accepted
---
# ADR-0076：Langfuse 调用链数据

## 背景

官方 Agent instrumentation 可以把模型输入输出、对话、工具载荷和上下文序列化进 span。此类
内容同时跨越用户数据、授权投影、检索来源和供应商边界；依靠 Collector 在下游逐字扫描既不能
证明完整，也会让 Temporal、日志与模型观测采用不同的数据最小化规则。

Langfuse 提供调用链和评分能力；运行 trace 与调用方显式提供的离线评测输入属于不同数据生命周期。

## 决策

使用 Langfuse Cloud 作为受信任的模型观测和评测平台。具体项目、区域、环境标识和凭据由部署配置
维护，不在本 ADR 固定。

- Agent producer 关闭 SDK sensitive data 导出；
- 运行 trace 只包含 user/session 关联、model/provider、agent/tool 名称、usage、阶段结果、耗时
  和有界关联 metadata；
- prompt、模型输入输出、对话、工具原始载荷、memory/retrieval 正文、provider 原始响应、认证
  材料和密钥不得进入任何运行 trace；
- App API、Ops Web、Temporal metadata 和 PostgreSQL 读取模型同样只保存各自合同允许的有界
  摘要；
- 运行时在进程启动时通过标准 OpenTelemetry 或官方集成启用发送，请求不能选择采样、发送端或
  数据接收目标；
- 仓库不建设原始生产模型调用采集、回放索引、差异存储或回放服务；
- 产品评测完成后可通过官方 SDK 将 score 发布到已有产品 trace；仓库不维护 Langfuse dataset 镜像
  或同步控制面；
- 需要正文的评测输入由调用方显式提供，不能从生产 trace 正文隐式生成；普通 trace 不能被反查为
  Ragas 正文输入；
- Ragas runner 只读取平台无关的本地 JSON；trace 身份只在 TypeScript 适配层用于可选 score 发布。

## 后果

### 内部模型格式失败诊断的例外

Executor 检索成功后发生输出格式错误的实际请求证明，仅保留错误码不能定位坏文本。
允许 Agent Runtime 为 `model_output_invalid` 向 Execution Control 返回有界可见失败文本，保存到
步骤结果的独立诊断列供现有 Ops 读取。该例外不属于运行 trace，也不建立全量采集或回放系统。
不保存 thinking、prompt、原始 SDK 响应或认证材料；正文不进入 receipt、Temporal、聊天事件或
后续模型上下文。按用户数据使用现有 Ops 访问边界和请求删除生命周期。普通日志和外部 trace 的
正文禁令不变。诊断缺失不阻塞业务，不自动重试或重新执行历史请求补录。

- 在线排查可以使用关联、模型、用量、阶段和低基数失败信息，但不能依赖生产 prompt 或回答
  回放；
- 评分元数据保持标量和白名单字段；评测输入正文不属于运行 trace，也不是普通离线 Ragas 的隐式
  事实来源；
- Langfuse 不可用不阻塞在线执行；Temporal 和 PostgreSQL 仍维护执行生命周期状态。

## 未采用方案

- **保留自研回放系统**：重复生命周期、安全、数据结构和运维能力；
- **在受信任 receiver 后保留模型输入输出**：网络隔离不能防止正文误采集、越权关联或下游泄露；
- **用实验接口重新执行已有产品调用**：会产生第二次执行和不一致的诊断证据。

## 与既有决策的关系

ADR-0059 继续拥有 Langfuse 平台；ADR-0081 继续拥有观测平面划分；ADR-0090 定义评测输入、
Ragas 和 Langfuse 之间的数据流。

## 相关文档

- `docs/contracts/langfuse-runtime.md`
- `docs/reference/telemetry.md`
- `docs/reference/eval.md`
- `docs/runbooks/ragas.md`
- `docs/decisions/adr-0090-eval-boundaries.md`
