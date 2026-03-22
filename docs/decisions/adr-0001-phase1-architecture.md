---
doc_type: decision
decision_id: ADR-0001
status: accepted
created: 2026-03-22
updated: 2026-03-22
---

# ADR-0001 第一阶段架构决策记录

适用范围：`campus-agent` v2 第一阶段上线实现

## 决策 1：Agno 的集成深度

结论：

- Agno 进入编排层和运行时层
- 不让 Agno 类型渗透到 contract 层和 retrieval abstraction 层

具体落点：

- `apps/supervisor-api`
  接 AgentOS runtime 和对外 HTTP 入口
- `packages/supervisor-core`
  使用 Agno 的 agent / team 语义组织 supervisor
- `packages/rag-specialist`
  使用 Agno specialist agent 包装层
- `packages/contracts`
  保持纯 Python schema
- `packages/retrieval-core`
  保持纯 retrieval 接口和实现适配

原因：

- 这样可以直接复用 Agno 的 team、session、trace、remote execution 能力
- 同时避免把 Agno 绑定成整个 monorepo 的底层类型系统
- 后续无论替换 retrieval 还是拆分远程 specialist，改动面都更小

## 决策 2：第一版生产 runtime

结论：

- 第一版生产 runtime 采用 AgentOS-native
- 对外产品接口保留自定义 HTTP 入口壳
- 第一阶段不保留旧 `/api/search`、`/api/answer` 兼容层

定义：

- AgentOS-native 的意思不是“不要 HTTP”
- 它本质上是基于 Agno AgentOS 的生产运行时和控制面
- 对外仍然可以暴露你们自己定义的 HTTP API

不采用的方案：

- 不手写一整套纯 FastAPI runtime 去替代 AgentOS 已有能力
- 不再为旧 RAG API 保留兼容层

原因：

- 这样可以直接复用 AgentOS 提供的 session、tracing、RBAC、streaming 和 team/workflow execution
- 同时保留产品 API 的自主定义能力

## 决策 3：第一版 retrieval 实现

结论：

- LlamaIndex 继续作为第一版 retrieval 实现
- 但它只能存在于 `packages/retrieval-core` 和 `packages/ingestion-core` 背后
- 第一阶段不从 day 1 设计多 backend 并行
- 第一阶段只支持 `student_handbook`
- 第一阶段直连共享 Qdrant

原因：

- 当前阶段最缺的是架构稳定性，不是 backend 多样性
- LlamaIndex 仍然足够胜任第一版 retrieval kernel
- 过早做多 backend 会增加中间层和评测矩阵，拖慢上线
- 共享向量存储已经锁定为外部存储，不需要在第一阶段再抽象第二条后端路径

后续升级条件：

- 当 eval 或线上数据证明 LlamaIndex 方案不够
- 或当某个关键能力必须脱离 LlamaIndex 才能获得
- 再引入第二实现并通过统一 contract 做对比

## 决策 4：第一阶段 ACL / 审计 / Traceability

结论：

- 第一阶段采用“最小上线闭环”
- 不追求一次性达到最终硬化形态

第一阶段必须做到：

- API 边界鉴权
- 请求级身份透传
- retrieval 前置过滤
- fail-closed
- 最小 source citations
- 集中 tracing
- 最小审计日志
- ingestion 结构化日志
- 文档层与 chunk 层 ACL metadata

## 决策 5：第一阶段数据平面

结论：

- 第一阶段正式引入 ingestion/data plane
- 不使用本机文件系统作为长期真相源
- 采用 `Raw -> Processed -> Chunk/Index` 三层分离
- 采用对象存储 + document registry + Qdrant
- 当前阶段对象存储采用本机部署的 `MinIO`
- 上层接口保持 `S3-compatible object storage`，为未来迁移云对象存储保留兼容性

具体落点：

- 新增 `apps/ingestion-worker`
  作为队列消费和摄入运行时
- 新增 `packages/ingestion-core`
  作为去重、解析、chunking、embedding 逻辑层
- `packages/retrieval-core`
  消费 document registry 与 Qdrant，而不是只消费向量库
- object storage 由本机 `MinIO` 提供 raw / processed bucket

原因：

- 这样不会把 ingestion 留成后续技术债
- 这样可以在第一阶段就建立 stable document ID / version ID / chunk ID
- 这样可以支撑后续增量更新、删除、审计和重处理
- 这样在暂时不能使用云服务时，仍然能保持和未来托管对象存储一致的 S3 接口语义

相关约束文档：

- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/plans/agentic-rag-foundation.md`

延后到硬化阶段：

- chunk-level / field-level ACL
- 完整 ABAC / policy engine
- 不可变审计账本
- 强 replayable evidence bundle
- 全量 HITL / approval flow
- 发布审计和回放工具链

## 对仓库结构的直接影响

- `apps/supervisor-api` 作为 AgentOS runtime 和外部 API 的拼接层
- `apps/ingestion-worker` 作为 ingestion runtime
- `packages/supervisor-core` 作为唯一的 supervisor 策略实现层
- `packages/rag-specialist` 作为第一阶段唯一主 specialist
- `packages/retrieval-core` 作为 registry + Qdrant 之上的 retrieval 抽象层
- `packages/ingestion-core` 作为 LlamaIndex 封装的数据摄入层
- `packages/contracts` 优先冻结 handoff、status、evidence bundle
- `packages/evals` 在增加第二 specialist 或第二 retrieval backend 之前先补齐

## 下一步执行顺序

1. 冻结 `packages/contracts` 的 supervisor -> specialist handoff schema 与 document/chunk/source 字段
2. 增加 `packages/ingestion-core` 和 `apps/ingestion-worker`
3. 在 `packages/retrieval-core` 中封装第一版 LlamaIndex + Qdrant backend
4. 在 `packages/rag-specialist` 中实现委派和置信度返回
5. 在 `apps/supervisor-api` 中接入 AgentOS runtime 和外部 API 壳
6. 在 `packages/evals` 中建立第一批 query + ingestion 基线场景

当前 phase-1 实现入口：

- `packages/rag-specialist/src/campus_rag_specialist/service.py`
- `packages/supervisor-core/src/campus_supervisor_core/__init__.py`
- `apps/supervisor-api/src/campus_supervisor_api/app.py`
- `packages/evals/src/campus_evals/runner.py`
