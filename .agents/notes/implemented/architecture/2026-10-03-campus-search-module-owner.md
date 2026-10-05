# Agent Note: Campus Search 模块 owner 与一次切换

Status: implemented

## 背景

第一批独立了 Campus Search 进程，但检索领域、provider adapter 和 current-index 读取仍属于
execution-control Go module，并保留本地 fallback。多个 Bot 需要共享同一检索能力，继续共享实现 owner
会让部署凭据、网络边界和服务生命周期无法闭合。

## 决策

- `apps/campus-search` 是唯一 Campus Search Go module，拥有公共检索合同、服务实现、索引读取和 provider adapter。
- execution-control 只保留 Agent adapter、run 绑定、citation、诊断和 typed HTTP client。
- execution-control 不再初始化或调用本地检索路径；服务不可用直接返回稳定阶段错误。
- 内部 HTTP 失败保留检索阶段、超时语义和部分诊断，避免服务拆分丢失 Ops 排障所需信息；公共错误不返回内部诊断。
- 检索服务通过已有阶段回调采集真实完成时间，在内部成功及失败响应中返回；execution-control 随终态合并到既有阶段记录。Ops 依赖这些记录展示完成状态和统计，不能用响应接收时间代替阶段时间，也不补造跳过的重排阶段。
- 公共文档链接在响应映射时使用已有的版本化章节路径，通知沿用来源路径，避免向公共消费者返回空文档链接。
- execution-control 按结果身份将候选诊断编号映射到 run 引用编号，避免调用内编号覆盖跨调用编号。
- 独立工作负载复用现有 PostgreSQL 与 Qdrant CA 挂载，延续数据库 TLS 验证和检索连接合同；execution-control 仅保留仍在使用的 PostgreSQL CA 挂载。
- Campus Search 使用独立 PostgreSQL 只读 role、数据库 Secret、Qdrant/Model Config 网络出口和 MCP client token Secret；execution-control 与检索服务共享独立的 retrieval internal token。
- `/v1/search` 和 `/internal/v1/search` 继续作为唯一 HTTP 合同；Agent 与 MCP 通过不同接口消费同一服务。
- 公共请求继续使用 400/800 字符限制；Agent 内部请求使用 1000/2000 字符的有界输入，以容纳调用方在传输前对相对年份的归一化，不把归一化后的长度误判为原始请求越界。
- 服务在 HTTP 写入截止时间前用独立的总检索 deadline 取消 embedding、Qdrant 和 reranker 调用，并返回合同规定的 504。
- 服务、凭据、网络策略和 client 同批切换，不保留双读或 fallback。

## 未采用方案

- 不把实现继续放在 execution-control module 中，仅增加一个独立进程。
- 不保留 execution-control 本地检索 fallback 或双读观察期。
- 不把 Agent 生命周期字段、Qdrant、embedding 或 reranker 暴露给 Bot。
- 仅调整 Ops 文案可掩盖完成状态错误，但无法恢复阶段时间线，因此保留服务内的真实时间并随响应回填；本次无需引入实时事件传输。

## 后果

Campus Search 可以独立发布并服务多个 MCP 客户端；execution-control 与 MCP 只承担各自协议和运行时职责。Bot 到 MCP 使用 stdio，MCP 到公共检索接口才使用 MCP client token。
服务不可用会直接成为检索阶段失败，需要通过 readiness、合同测试和部署配置校验保证一次切换可用。
Ops 的服务内阶段在内部 HTTP 响应到达后可见；未收到响应时，不推断服务内已完成阶段。

相关第一批边界见 [Campus Search 独立服务与 Bot 适配边界](./2026-10-03-campus-search-service.md)。
