---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0060
status: accepted
---
# ADR-0060 Agent 输入输出

## 背景

模型输入输出曾被当作一份不断增长的 system prompt。这样会把运行策略、工具开放、
不可信正文、输出结构和终态判断混在一起，使模型文案承担本应由代码执行的边界。

## 决策

### 代码拥有运行边界

- 代码拥有认证、策略、能力开放、数据范围、执行预算、终止条件、schema 校验、证据校验
  和最终投影。
- developer instructions 只保留跨工具、长期稳定的不变量；不得替代这些代码边界。
- 运行时把 deadline、turn、输出和上下文限制作为 typed input 传递，不让模型运行时从
  隐式环境变量或宽松默认值推断。

### 输入按信任边界装配

- 角色指令、允许的工具、typed task packet 和输出合同属于受信任控制数据。
- 用户正文、历史会话、检索内容、记忆和工具返回值始终作为明确标注的不可信数据。
- 不可信正文不得拼入 developer instructions，也不得以指令语气覆盖运行时边界。

### 工具和终态使用可执行 schema

- 模型可见工具通过 function/tool schema 描述用途、参数和副作用；跨工具规则才进入
  developer instructions。
- primary direct path、handoff agent 和 tool-backed path 使用同一类 typed terminal
  contract，不以自由文本或消费端默认值表示成功。
- evidence-backed 结果必须携带可由代码核验的 evidence refs；终态校验不得再调用模型
  补齐或改写答案。

### 不完整输出必须失败关闭

- provider failure、refusal、incomplete、缺少结构化结果、schema 错误和伪造证据引用都
  产生明确失败结果。
- 消费端不得用空答案、默认置信度或通用 no-answer 掩盖这些状态。
- JSON、streaming 和持久化投影必须保留同一终态语义。

具体 packet 字段、终态枚举、错误码和 prompt trace 由 executable contract 与所属运行时
文档维护，本 ADR 不复制动态清单。

## 后果

- prompt 变更不能放宽代码拥有的能力、数据或证据边界。
- 新 agent 或 handoff 必须复用终态和证据合同，除非新的 ADR 接受独立语义。
- prompt registry、管理后台或托管模板不是可靠性的前置条件；出现真实治理需求后再决策。

## 未采用方案

- **单一大型 system prompt**：无法可靠执行认证、工具开放和 schema 校验。
- **为 handoff 保留自由文本结果**：会产生第二套不可验证的终态。
- **消费端修补模型输出**：会掩盖 provider 和合同失败。

## 相关文档

- `../architecture/system/prompt.md`
- `../architecture/system/agent-framework.md`
- `../contracts/tool-execution.md`
- `adr-0048-temporal.md`
