# Agent Note: Campus Search 模块 owner 与一次切换

Status: implemented

## 背景

第一批独立了 Campus Search 进程，但检索领域、provider adapter 和 current-index 读取仍属于
execution-control Go module，并保留本地 fallback。多个 Bot 需要共享同一检索能力，继续共享实现 owner
会让部署凭据、网络边界和服务生命周期无法闭合。

## 当前适用范围

[Agent 编排与 Memory 独立服务](./2026-10-10-agent-orchestration-memory-services.md)部分取代本文的 Agent 消费方所有权：Runtime 直接调用 Search
并分配引用编号，Control 保留准入、collection 绑定和投影。独立 Search、公共/内部接口及 Bot MCP
边界继续有效；拆分初期的 execution-control adapter 不是当前调用入口。

## 决策

- `apps/campus-search` 是唯一 Campus Search Go module，拥有公共检索合同、服务实现、索引读取和 provider adapter。
- agent-runtime 拥有工具 adapter、HTTP client 和引用分配；agent-control 拥有 run/collection 绑定与投影。
- Runtime 不初始化或调用本地检索路径；服务不可用直接返回稳定阶段错误。
- 内部 HTTP 失败保留检索阶段、超时语义和部分诊断，避免服务拆分丢失 Ops 排障所需信息；公共错误不返回内部诊断。
- 检索服务通过已有阶段回调采集真实完成时间，在内部成功及失败响应中返回。原先由 Control
  合并诊断并供 Ops 展示的路径已不完整：当前 Runtime 未透传完整 `diagnostics`，Control observation
  的 `Snapshot`、`PhaseTimes` 也不接受 JSON 输入。服务能产出这些字段，不代表 Ops 已能看到。
  当前缺口见[检索合同](../../../../docs/contracts/campus-search.md)，不能用响应接收时间补造服务阶段时间。
- 公共文档链接在响应映射时使用已有的版本化章节路径，通知沿用来源路径，避免向公共消费者返回空文档链接。
- Runtime 按结果身份分配 run 引用编号，避免调用内编号覆盖跨调用编号；完整候选诊断尚未随之透传。
- 独立工作负载复用现有 PostgreSQL 与 Qdrant CA 挂载，延续数据库 TLS 验证和检索连接合同；agent-control 仅保留仍在使用的 PostgreSQL CA 挂载。
- Campus Search 使用独立 PostgreSQL 只读 role、数据库 Secret、Qdrant/Model Config 网络出口和 MCP client token Secret；agent-runtime 与检索服务共享独立的 retrieval internal token。
- `/v1/search` 和 `/internal/v1/search` 继续作为唯一 HTTP 合同；Agent 与 MCP 通过不同接口消费同一服务。
- 公共请求继续使用 400/800 字符限制；Agent 内部请求使用 1000/2000 字符的有界输入，以容纳调用方在传输前对相对年份的归一化，不把归一化后的长度误判为原始请求越界。
- 服务在 HTTP 写入截止时间前用独立的总检索 deadline 取消 embedding、Qdrant 和 reranker 调用，并返回合同规定的 504。
- 服务、凭据、网络策略和 client 同批切换，不保留双读或 fallback。

## 未采用方案

- 不把实现继续放在 execution-control module 中，仅增加一个独立进程。
- 不保留 execution-control 本地检索 fallback 或双读观察期。
- 不把 Agent 生命周期字段、Qdrant、embedding 或 reranker 暴露给 Bot。
- 仅调整 Ops 文案可掩盖完成状态错误，但无法恢复阶段时间线，因此当时选择随响应回填真实时间；当前消费链的覆盖缺口如上，不因保留该理由而视为已经修复。

## 后果

Campus Search 可以独立发布并服务多个 MCP 客户端；Runtime、Control 与 MCP 只承担各自协议和运行时职责。Bot 到 MCP 使用 stdio，MCP 到公共检索接口才使用 MCP client token。
服务不可用会直接成为检索阶段失败，需要通过 readiness、合同测试和部署配置校验保证一次切换可用。
Search 响应中的服务内阶段目前未完整进入 Ops；不能从顶层调用状态推断完整检索阶段或耗时分布。

相关第一批边界见 [Campus Search 独立服务与 Bot 适配边界](./2026-10-03-campus-search-service.md)。
