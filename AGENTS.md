# AGENTS.md

## Project Snapshot

`campus-agent` 是校园助理系统的 v2 入口 monorepo。

- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- 架构目标是 `supervisor-led multi-agent orchestration`，不是继续把 RAG 建模成入口 agent 直接调用的扁平 tool
- 当前仓库仍处于 v2 基线阶段；它是长期架构骨架，不是完整产品实现
- `apps/` 表示 transport/runtime boundary，`packages/` 表示稳定能力边界
- runtime 选择尚未 repo-wide 冻结；当前只对 `apps/app-api` 明确冻结为 Worker，其余边界尤其 `apps/supervisor-api` 不要为了实现便利提前绑定到单一 HTTP 框架
- 不要按旧 bootstrap 的 tool-adapter 模式扩展当前仓库；如需追溯旧实现请查看 git 历史

### Branch Model

- `develop` 是长期集成分支，`main` 是稳定分支
- 讨论“当前 merged truth”时，默认指已合入 `develop` 的状态；如果讨论当前 worktree / feature branch，必须显式写明
- 独立 worktree 中尚未回 `develop` 的实现进度，不得冒充 merged truth

## Source Of Truth

先看这些文件，再做结构性修改：

- `README.md`
- `docs/README.md`
- `docs/architecture/long-term-architecture.md`
- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/architecture/phase1-ingestion-and-storage-architecture.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/plans/agentic-rag-foundation.md`
- `docs/plans/app-api-worker-foundation.md`
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`

工作规则：

- `AGENTS.md` 只负责仓库入口约束、目录导航和工作协议，不重复深层设计文档
- 这个仓库当前没有业务意义上的 `refs/` 目录；默认把 `README.md` 和 `docs/` 视为实现与架构的参考材料
- 长期边界、阶段决策、accepted implementation baseline 与实施门禁分别以对应 `docs/` 文档为准
- 当前 phase 执行状态、pending work、最新讨论结论与当前轮计划以 `.planning/` 为准
- 不要把 `docs/plans/agentic-rag-foundation.md` 中的早期 phase-1 实施叙事直接当作当前执行状态；它是第一阶段地基的 canonical 实施基线，不是当前 GSD 进度板
- 如果这里的表述和深层设计文档冲突，以深层设计文档为准，并优先修正本文件
- 在引用 Source Of Truth 之前，先确认是否准确理解了用户当前问题；不得用文档权威覆盖对用户原意的错误理解

## Interpretation Protocol

这些规则优先于所有架构、实现、优化和“最佳实践”判断。

### Meta Rule

- 解释错误优先级高于架构错误。
- 如果对用户原意的理解是错的，那么后续所有基于边界、架构、最佳实践的纠偏都会失真。
- 出现冲突时，先修正理解，再应用架构规则。

### User Intent First

- 先按用户原话的最自然、最善意语义理解问题。
- 不要把用户的短句自动扩展成更差、更极端或更危险的版本。
- 不要为了展示边界意识而反驳一个用户没有明确提出的 strawman。
- 如果用户的话存在多种解释，默认先回答自然解释，而不是风险扩展解释。
- 只有当风险扩展解释会实质影响答案正确性或实现安全性时，才允许显式提出；并必须明确标注“这是额外风险分支，不是用户原话本身”。

### Anti-Strawman Rule

- 不要把“基于日志做请求视图”自动解释成“直接把原始日志暴露给前端”。
- 不要把“加一个 panel backend”自动解释成“复制第二套业务后端”。
- 不要把“先套 react-admin”自动解释成“放弃 Worker shell 边界”。
- 不要把“是否符合最佳实践”自动改写成“如果把它做成最坏版本是否还合理”。
- 反驳时只能反驳用户实际提出的方案，或明确标注为额外扩展分支的方案。

### Clarification Threshold

- 如果自然解释已经足够回答问题，不要为了防腐烂而额外追问。
- 如果自然解释和高风险解释会导出完全不同结论，先用一句话明确你当前采用的解释。
- 澄清问题时，应围绕语义分歧本身，不要预设对方在主张更差方案。

### Interpretation Priority

当用户表达存在歧义时，按以下顺序理解：

1. 用户原话的自然语义
2. 仓库内已落盘文档中的同名概念
3. 当前代码与实现上下文
4. 明确标注的风险扩展解释
5. 个人推断

禁止跳过 1-3，直接用 4 或 5 覆盖用户原意。

## Answering Protocol

### Directness

- 先回答用户实际问的问题。
- 不要先把问题改写成另一个更坏的问题再回答。
- 判断题、评审题、设计辨析题，先给结论，再给依据。

### Scope Discipline

- 不要把未被请求的延伸实现、替代方案或未来工作混进主答案。
- 只有当额外说明是当前答案成立所必需时，才加入额外风险或额外约束。
- 当用户在询问、评审、辨析、比较或校正时，不要默认追加下一步建议。
- 不要用“如果你要，我可以继续……”作为默认收尾。

### Risk Branch Labeling

- 如果需要讨论额外风险分支，必须显式使用“如果进一步做成 X，则会有风险”这类措辞。
- 不得把 X 写成用户已经主张的内容。
- 回答“最佳实践”类问题时，优先评价用户当前描述的方案，不要优先评价你自己扩展出的变体。

### No Conversational Smoothing

- 不要为了让回答显得顺滑而自动补一个“低成本方案”“最小改法”或“保守起步方案”。
- 不要把规则设计、架构设计或仓库协议设计回答成默认的工程折中术。
- 只有当用户明确要求比较不同实施力度时，才允许给出分层方案。

## Architecture Guardrails

以下规则只在“用户原意已经被准确理解之后”生效。

- 不要把 retrieval 实现细节、索引构建逻辑或向量数据库特定代码拉回 `packages/supervisor-core`
- 不要把 `campusRAG` 再建模成入口 agent 直接调用的扁平 tool；v2 的主模型是 supervisor -> specialist handoff
- 不要让 `Agno`、`LlamaIndex`、`Qdrant`、`MinIO` 或其他具体基础设施类型泄漏进 `packages/contracts`
- 不要把 online query path 和 offline ingestion/data plane 混在同一层
- 不要把本机目录语义提升成长期对象存储真相源；当前阶段对象存储虽然可本机部署，但架构语义上仍是 `S3-compatible object storage`
- 任何实现都应先尊重已冻结的 contract 和 package 边界，再考虑 runtime 或框架便利性
- 第一阶段查询默认语料是 `student_handbook`；如需新增 data-plane corpus，必须同步更新决策/计划文档并保持 retrieval 范围显式不变

### Architecture Over Patchwork

- 修复问题时，优先恢复正确边界和长期形态，不要默认选择最小改动
- 如果问题来自错误抽象、错误分层或错误 contract，优先修边界本身，不要在外围堆 patch
- 不要为了短期通过测试而新增临时兼容层、双路径逻辑、一次性适配层或“以后再删”的过渡代码，除非存在明确外部迁移约束
- 当实现方案和长期正确方案冲突时，默认选择长期正确方案；若选择兼容层，必须有明确外部依赖理由
- 不要沿着现有 hack 继续扩建；现有坏边界不是新增坏边界的理由
- 这些规则不能作为误解、放大或改写用户原问题的理由

## Execution Protocol

### Working Rules

- 做结构性改动前，先读 `Source Of Truth` 中对应文档
- 优先在边界内修改；跨多个 package 改动时，先确认 `packages/contracts` 是否需要先冻结或先调整
- 仓库仍在地基阶段；优先补最小可验证闭环，不做“未来也许会用到”的泛化设计
- Node / Worker app 默认使用 `pnpm`，不再新增或维护 `package-lock.json`
- 如果变更触及长期边界、phase-1 约束或对象存储/ingestion 不变量，同步检查相关 `docs/architecture` 或 `docs/decisions` 是否需要更新
- 不要在 repo 级 `AGENTS.md` 里写个人工作习惯、平台专属工具细则或一次性实验说明；这些内容应放到全局 agent 配置
- 在规则、架构、文档和实现设计层面，同样禁止用“最小改法”替代长期正确的结构性修正

### Git Commit Title Rules

- 默认使用 `Conventional Commit` 前缀加中文标题：`<type>: <中文结果描述>`
- 常用前缀保持语义清晰：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`
- 冒号后优先写中文结果描述，直接说明这次提交完成了什么，不写空泛过程词
- 标题优先使用动宾结构，例如：`添加`、`完成`、`修复`、`重构`、`明确`、`迁移`、`简化`、`调整`
- 需要补充阶段、任务号或关键上下文时，放在标题末尾括号内，不要喧宾夺主
- 默认参考仓库已有中文提交风格，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice + navigation_mode）`
- 避免使用纯英文或无信息量标题，例如：`init`、`init again`、`update stuff`

### Subagent Guidance

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

### Nested AGENTS Convention

- 根 `AGENTS.md` 提供整个 monorepo 的默认规则
- 如果某个 `apps/*` 或 `packages/*` 需要特殊工作流，可在对应目录新增更细粒度的 `AGENTS.md`
- 子目录 `AGENTS.md` 只补充局部差异，不重复根文件的通用规则
- 指令应尽量靠近实际工作目录，保持文件短小、可扫读、可覆盖

## External Verification

- 对“最佳实践”“最新推荐”“官方当前能力边界”“当前模型、agent、runtime 建议”这类问题，先联网查官方资料再回答
- 优先查 `developers.openai.com`，其次 `openai.com`
- 如果查不到足够依据，就明确说不确定，不要沿用旧知识补全
- 回答时附实际参考链接，并区分文档事实与推断
- 仓库本地事实、代码结构、已落盘 docs 不需要联网

## Verification

默认使用 `uv` 管理的 workspace 环境。

环境准备命令：

```bash
uv sync --all-packages --dev
```

默认仓库级验证命令：

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

JS/TS surface 的默认验证命令：

```bash
pnpm install
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
```

面向 `develop` 的增量验证命令：

```bash
pnpm web:typecheck:affected
pnpm web:test:affected
pnpm web:build:affected
```

补充约束：

- 默认不要直接运行裸 `python3` 或裸 `pytest`
- 仓库级基线验证与局部测试命令默认都通过 `uv run --all-packages ...` 执行
- JS/TS app 的共享任务编排默认通过 repo root `pnpm` + `turbo` 入口执行，不再鼓励把跨 app 验证拆回各自目录手动串行运行
- `pnpm web:test` 是 JS/TS 默认稳定 gate；不要把它表述成自动覆盖所有 worker / integration lane
- `pnpm web:test:worker` 是显式 Worker runtime lane；`pnpm web:test:integration` 是显式外部依赖 integration lane
- `apps/app-api` 默认 `pnpm test` 只跑 `test:node`；`test:worker` 与 `test:shared-db-integration` 必须显式调用
- 如果新增局部测试或检查命令，只记录仓库里真实存在、可重复执行的命令
- 不要把“担心腐烂”当成替代验证证据的理由
- 当提出某种设计风险时，应尽可能区分：文档事实、代码事实，以及你的推断

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
