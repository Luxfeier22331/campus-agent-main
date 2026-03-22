# AGENTS.md

## Project Snapshot

`campus-agent` 是校园助理系统的 v2 入口 monorepo。

- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- 架构目标是 `supervisor-led multi-agent orchestration`，不是继续把 RAG 建模成入口 agent 直接调用的扁平 tool
- 当前仓库仍处于 v2 基线阶段；它是长期架构骨架，不是完整产品实现
- `apps/` 表示 transport/runtime boundary，`packages/` 表示稳定能力边界
- runtime 选择尚未冻结；不要为了实现便利提前把仓库绑定到单一 HTTP 框架
- 不要按旧 bootstrap 的 tool-adapter 模式扩展当前仓库；如需追溯旧实现请查看 git 历史

## Source Of Truth

先看这些文件，再做结构性修改：

- `README.md`
- `docs/README.md`
- `docs/architecture/long-term-architecture.md`
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `docs/decisions/adr-0001-phase1-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/plans/agentic-rag-foundation.md`

工作规则：

- `AGENTS.md` 只负责仓库入口约束、目录导航和工作协议，不重复深层设计文档
- 这个仓库当前没有业务意义上的 `refs/` 目录；默认把 `README.md` 和 `docs/` 视为实现与架构的参考材料
- 长期边界、阶段决策、实施门禁分别以对应 `docs/` 文档为准
- 如果这里的表述和深层设计文档冲突，以深层设计文档为准，并优先修正本文件

## Repo Map

- `apps/supervisor-api`: 对外服务边界与 transport adapter；不要把核心编排逻辑塞进这里
- `apps/ingestion-worker`: ingestion runtime 壳；承接摄入任务，不负责在线回答编排
- `packages/supervisor-core`: supervisor 的路由、委派、答案组装与升级逻辑
- `packages/rag-specialist`: 知识域 specialist 入口；负责 retrieval 导向的 query/answer/confidence 逻辑
- `packages/retrieval-core`: retrieval abstraction、evidence 获取与回链路径
- `packages/ingestion-core`: ingestion/data plane 的逻辑消费层，负责去重、版本推进、解析、chunking、索引写入编排
- `packages/contracts`: supervisor -> specialist handoff、evidence bundle 与共享 schema；不要泄漏运行时或基础设施类型
- `packages/evals`: 回归场景、基线与 smoke/eval 入口
- `packages/shared`: 轻量共享常量和工具；不要演变成业务逻辑垃圾桶

## Architectural Guardrails

- 不要把 retrieval 实现细节、索引构建逻辑或向量数据库特定代码拉回 `packages/supervisor-core`
- 不要把 `campusRAG` 再建模成入口 agent 直接调用的扁平 tool；v2 的主模型是 supervisor -> specialist handoff
- 不要让 `Agno`、`LlamaIndex`、`Qdrant`、`MinIO` 或其他具体基础设施类型泄漏进 `packages/contracts`
- 不要把 online query path 和 offline ingestion/data plane 混在同一层
- 不要把本机目录语义提升成长期对象存储真相源；当前阶段对象存储虽然可本机部署，但架构语义上仍是 `S3-compatible object storage`
- 任何实现都应先尊重已冻结的 contract 和 package 边界，再考虑 runtime 或框架便利性
- 第一阶段默认语料是 `student_handbook`；不要在未更新决策/计划文档前擅自扩大 corpus 范围

## Working Rules

- 做结构性改动前，先读 `Source Of Truth` 中对应文档
- 优先在边界内修改；跨多个 package 改动时，先确认 `packages/contracts` 是否需要先冻结或先调整
- 仓库仍在地基阶段；优先补最小可验证闭环，不做“未来也许会用到”的泛化设计
- 如果变更触及长期边界、phase-1 约束或对象存储/ingestion 不变量，同步检查相关 `docs/architecture` 或 `docs/decisions` 是否需要更新
- 不要在 repo 级 `AGENTS.md` 里写个人工作习惯、平台专属工具细则或一次性实验说明；这些内容应放到全局 agent 配置

## Answering Rules

- 当用户在询问、评审、辨析、比较或校正时，不要默认追加下一步建议
- 不要用“如果你要，我可以继续……”作为默认收尾
- 只有当后续动作是当前答案成立所必需，或用户明确要求继续推进时，才提出下一步
- 回答先停在结论，不要为了“推进对话”补未被请求的动作建议

## Architecture Over Patchwork

- 修复问题时，优先恢复正确边界和长期形态，不要默认选择最小改动
- 如果问题来自错误抽象、错误分层或错误 contract，优先修边界本身，不要在外围堆 patch
- 不要为了短期通过测试而新增临时兼容层、双路径逻辑、一次性适配层或“以后再删”的过渡代码，除非存在明确外部迁移约束
- 当“最小改动方案”和“长期正确方案”冲突时，默认选择长期正确方案；若选择兼容层，必须有明确外部依赖理由
- 不要沿着现有 hack 继续扩建；现有坏边界不是新增坏边界的理由

## External Verification

- 对“最佳实践”“最新推荐”“官方当前能力边界”“当前模型、agent、runtime 建议”这类问题，先联网查官方资料再回答
- 优先查 `developers.openai.com`，其次 `openai.com`
- 如果查不到足够依据，就明确说不确定，不要沿用旧知识补全
- 回答时附实际参考链接，并区分文档事实与推断
- 仓库本地事实、代码结构、已落盘 docs 不需要联网

## Verification

默认仓库级验证命令：

```bash
python3 -m unittest discover -s tests -t .
```

补充约束：

- 根 `pyproject.toml` 已配置 `pytest`，但仓库级基线验证以当前已存在的 `unittest discover` 命令为准
- 如果新增局部测试或检查命令，只记录仓库里真实存在、可重复执行的命令

## Subagent Guidance

优先把可独立处理的子任务拆开处理，但前提是任务天然可并行、边界清晰、责任可分配。

- 先判断是否存在独立子任务；如果可以拆开，优先按模块边界委派，而不是把所有工作串行堆给主代理
- 优先按模块边界切分子任务，例如 `contracts`、`ingestion-core`、`retrieval-core`、`rag-specialist` / `supervisor-core`、`evals`
- 按依赖顺序并行，不要无视 contract 和强耦合关系；`docs/plans/agentic-rag-foundation.md` 里的分批策略可作为默认参考
- 并行工作时避免共享写集；每个 subagent 应拥有明确的文件或模块责任
- `contracts` 未冻结前，不要并行推进依赖它的接口形状；关键 contract 变更统一由主代理收口
- 复杂任务可以并行探索或分工实现，但主代理负责最终取舍、集成和验证
- 只有在任务很小、完全不值得切分时才不拆分；不要因为习惯而默认单线程执行
- 被委派的子任务继承当前 sandbox/approval 约束；不要假设它们能绕过父任务的权限边界

如果后续需要 repo-local custom agents：

- 放在 `.codex/agents/`
- 每个 agent 只负责单一、可重复的职责
- 名称直接描述用途，不要使用模糊命名
- 先用 root `AGENTS.md` 和目录级 `AGENTS.md` 解决通用约束，再考虑新增 custom agent

## Nested AGENTS Convention

- 根 `AGENTS.md` 提供整个 monorepo 的默认规则
- 如果某个 `apps/*` 或 `packages/*` 需要特殊工作流，可在对应目录新增更细粒度的 `AGENTS.md`
- 子目录 `AGENTS.md` 只补充局部差异，不重复根文件的通用规则
- 指令应尽量靠近实际工作目录，保持文件短小、可扫读、可覆盖
