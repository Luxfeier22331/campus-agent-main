# AGENTS.md

## Project Snapshot

`campus-agent` 是校园助理系统的 v2 入口 monorepo。

- 当前在线回答主路径是 `app-api -> execution-control -> Temporal ->
  CapabilityExecutionWorkflow -> activity-worker-context /
  activity-worker-knowledge / capability workers /
  activity-worker-finalization ->
  memory recall / typed capability branch / Go RAG DTO/runtime ->
  Qdrant / provider / structured read models -> sanitized projection`
- 当前 product entry surface 已收口到 `campus-web -> student experience /
  account shell / docs reader`；`operator-console-web` 与 legacy
  `public-chat-web` 作为并列 browser surface 进入 shared `app-api`
- 架构目标是 capability-neutral orchestrated execution：顶层由 Execution Agent Layer
  做 admission、routing、workflow planning 与 finalization；RAG、navigation、
  notice、services 等能力默认以 typed tool / workflow capability 进入，只有存在明确语义职责时才表现为
  agent-as-tool
- 当前 accepted merged truth 已具备 `regulations/student_rules`、
  `regulations/institutional_rules`、`curriculum/curriculum_plan` 与
  `official_web/stable_reference` 四条默认 query-enabled surface，以及 `campus-web`、
  `public-chat-web`、`operator-console-web`、`app-api` 等前向产品形态；
  但它仍不是完整产品实现
- `apps/` 表示 transport/runtime boundary，`packages/` 表示稳定能力边界
- runtime 当前事实是 `apps/app-api = Worker`，`apps/execution-control =
  Docker-first internal execution-control service`，Temporal 是 execution
  substrate，PG 只承载 sanitized run / event / step projection；online path
  已硬切为 `context.memory_recall -> agent.primary -> direct/no-tool or
  admitted typed tool / RAG branch -> finalization.write`，knowledge 分支由
  Go-owned RAG Temporal graph 执行，worker plane / autoscaler 仍按对应架构文档继续收口
- Python `apps/supervisor-agent-worker` 已从 active workspace 删除；旧实现只可通过
  git history 追溯，不得重新接入 serving
- 不要按旧 bootstrap 的 tool-adapter 模式扩展当前仓库；如需追溯旧实现请查看 git 历史

### Branch Model

- `develop` 是长期集成分支，`main` 是稳定分支
- 讨论“当前 merged truth”时，默认指已合入 `develop` 的状态；如果讨论当前 worktree / feature
  branch，必须显式写明
- 独立 worktree 中尚未回 `develop` 的实现进度，不得冒充 merged truth

## Source Of Truth

先看这些文件，再做结构性修改：

- `README.md`
- `docs/README.md`
- `docs/architecture/product-positioning.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-agent-layer-architecture.md`
- `docs/architecture/system/tool-and-capability-runtime-architecture.md`
- `docs/architecture/system/agent-framework-boundary-architecture.md`
- `docs/architecture/system/capability-routing-and-admission-architecture.md`
- `docs/architecture/system/durable-agent-runtime-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/code-organization-and-decomposition-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/identity-browser-experience-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/architecture/system/memory-plane-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/domains/navigation/architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web-source-truth-schema.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/data/wechat-official-account-source-truth-schema.md`
- `docs/data/identity-platform-schema.md`
- `docs/contracts/campus-notice-runtime-contract.md`
- `docs/contracts/app-api-identity-platform-http.md`
- `docs/contracts/app-api-federation-http.md`
- `docs/reference/authenticated-notice-file-release-export-contract.md`
- `docs/decisions/adr-0002-local-minio-conventions.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0011-operator-console-worker-runtime.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0048-temporal-execution-plane.md`
- `docs/decisions/adr-0053-qdrant-native-personal-memory-index.md`
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/decisions/adr-0027-navigation-capability-and-spatial-truth.md`
- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/decisions/adr-0046-gsd-sdk-and-codex-native-workflow.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/policies/official-web-crawl-policy.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

工作规则：

- `AGENTS.md` 只负责仓库入口约束、目录导航和工作协议，不重复深层设计文档
- 这个仓库当前没有业务意义上的 `refs/` 目录；默认把 `README.md` 和
  `docs/` 视为实现与架构的参考材料
- 产品定位、目标用户与产品边界以 `docs/architecture/product-positioning.md` 为准
- 当前 accepted merged-truth topology 与已开放 serving surface 以
  `docs/architecture/current-architecture.md` 为准
- 目标架构、supporting architecture、accepted architecture constraint 与术语约束分别以对应
  `docs/` 文档为准
- 代码组织、目录分解、小区块、目录同构与不重复治理以
  `docs/architecture/system/code-organization-and-decomposition-architecture.md`
  为准；`pnpm decomposition:lint` 只是基础行数 / baseline gate，不等于完整架构
  review
- 当前 repo 级范围、pending work 信号与最新长期结论以 `.planning/PROJECT.md` 和
  `.planning/WORKSTREAMS.md` 为准；本地会话状态由 GSD SDK / Codex native session
  承接，不再写回 tracked phase 目录
- tracked historical planning archives 已从 branch tip 清理；需要追溯时通过 git history 恢复具体
  片段，再提升到当前 docs / ADR / runbook
- 不要把 `docs/architecture/target-architecture.md` 当作当前 merged truth 或当前 GSD
  进度板；当前真相看 `current-architecture.md`，当前执行状态看
  `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与 GSD SDK / Codex native session
- 如果这里的表述和深层设计文档冲突，以深层设计文档为准，并优先修正本文件
- 在引用 Source Of Truth 之前，先确认是否准确理解了用户当前问题；不得用文档权威覆盖对用户原意的错误理解

## Interpretation Protocol

这些规则优先于所有架构、实现、优化和“最佳实践”判断。

### Meta Rule

- 解释错误优先级高于架构错误。
- 如果对用户原意的理解是错的，那么后续所有基于边界、架构、最佳实践的纠偏都会失真。
- 出现冲突时，先修正理解，再应用架构规则。

### Question Type Detection

- 先判断用户在问哪一类问题，再决定是否需要调用架构约束。
- 至少区分以下几类：
  - `architecture truth` 例如仓库当前 accepted topology、merged truth、长期边界是否已冻结
  - `deployment substrate` 例如某个 app 先跑在 Docker、Worker、VM、本机进程还是 tunnel 后面
  - `local dev / test path` 例如为了联调、验证或 smoke，临时怎样把链路跑通
  - `implementation change` 例如是否需要改代码、改 contract、改 docs、改 runtime shell
- 不要把 `deployment substrate` 自动解释成 `architecture truth` 变更。
- 不要把 `local dev / test path` 自动解释成用户在主张修改 forward topology。
- 不要把“我自己怎么部署 / 怎么联调”自动解释成“仓库应该把这个部署方式冻结为长期真相”。
- 只有当用户明确在问 accepted topology、冻结决策、merged truth 或 repo-level 方案时，才按架构问题回答。

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
- 不要把“能不能先用 Docker / tunnel / 本机进程测试”自动解释成“是不是要改仓库 topology / merged truth”。
- 反驳时只能反驳用户实际提出的方案，或明确标注为额外扩展分支的方案。

### No Rewrite Of User Input

- 不要静默改写用户的问题，再去回答你改写后的版本。
- 不要把用户的部署问题改写成架构问题，不要把用户的评审问题改写成实施方案问题，不要把用户的判断题改写成风险演习题。
- 如果需要复述用户问题，复述后的名词、边界和判断力度必须与原问保持一致。
- 如果你的回答依赖额外假设，必须显式写出“以下回答基于 X 假设”，不能把假设伪装成用户原意。
- 如果用户是在纠正你，先吸收纠正，再回答；不要继续沿着旧误解重写用户的意思。

### Clarification Threshold

- 如果自然解释已经足够回答问题，不要为了防腐烂而额外追问。
- 如果自然解释和高风险解释会导出完全不同结论，先用一句话明确你当前采用的解释。
- 澄清问题时，应围绕语义分歧本身，不要预设对方在主张更差方案。
- 追问的代价小于猜错返工的代价时，优先追问。
- 如果不追问也能给出高置信判断，就直接回答，并显式标注关键假设。

### Interpretation Priority

当用户表达存在歧义时，按以下顺序理解：

1. 用户原话的自然语义
1. 仓库内已落盘文档中的同名概念
1. 当前代码与实现上下文
1. 明确标注的风险扩展解释
1. 个人推断

禁止跳过 1-3，直接用 4 或 5 覆盖用户原意。

## Answering Protocol

### Directness

- 先回答用户实际问的问题。
- 不要先把问题改写成另一个更坏的问题再回答。
- 判断题、评审题、设计辨析题，先给结论，再给依据。
- 如果用户问的是“哪些”“能不能”“是不是”，先直接给列表、是/否或判断，不要先写背景综述。

### Output Contract

- 不要写不影响用户做决策的话。
- 直接给出结论或方案，不要铺垫。
- 省略显而易见的上下文和已知信息。
- 只在对理解关键逻辑有帮助时才举例。
- 默认优先给最短可用答案，而不是“完整但绕”的答案。
- 如果答案分为“文档事实 / 代码事实 / 推断”，只在这种区分会影响决策时再拆开写。
- 如果用户问题本身是窄问题，就保持窄回答；不要擅自扩成综述、路线图或风险清单。

### Scope Discipline

- 不要把未被请求的延伸实现、替代方案或未来工作混进主答案。
- 只有当额外说明是当前答案成立所必需时，才加入额外风险或额外约束。
- 当用户在询问、评审、辨析、比较或校正时，不要默认追加下一步建议。
- 不要用“如果你要，我可以继续……”作为默认收尾。
- 不要为了显得周全而重写用户的问题范围。
- 用户只问当前判断时，不要抢先回答“长期也许怎么做更好”。

### Risk Branch Labeling

- 如果需要讨论额外风险分支，必须显式使用“如果进一步做成 X，则会有风险”这类措辞。
- 不得把 X 写成用户已经主张的内容。
- 回答“最佳实践”类问题时，优先评价用户当前描述的方案，不要优先评价你自己扩展出的变体。

### No Conversational Smoothing

- 不要为了让回答显得顺滑而自动补一个“低成本方案”“最小改法”或“保守起步方案”。
- 不要把规则设计、架构设计或仓库协议设计回答成默认的工程折中术。
- 只有当用户明确要求比较不同实施力度时，才允许给出分层方案。

### No Rewrite Of The Answer

- 回答结构要贴合用户原问题，而不是贴合你更熟悉的另一个问题模板。
- 不要把一个可以一句话回答的问题，重写成一段防御式架构宣讲。
- 不要用“先澄清一个更大的问题”来替代当前问题的直接答案，除非当前问题在语义上确实无法成立。
- 如果你发现自己正在回答一个用户没问的问题，立即停下，回到原问题。

## Architecture Guardrails

以下规则只在“用户原意已经被准确理解之后”生效。

- 不要把 retrieval 实现细节、索引构建逻辑或向量数据库特定代码拉进 Execution Agent Layer /
  agent-as-tool 层
- 不要把旧 bootstrap 模式恢复为产品入口、顶层 router、hidden mega-agent
  或扁平 retrieval tool；RAG 只能在已 admitted 的 knowledge-family / RAG capability 内部承担
  retrieval planning、evidence verification、synthesis 与 grounding 语义
- 不要让 `Agno`、`LlamaIndex`、`Qdrant`、`MinIO` 或其他具体基础设施类型泄漏进 `packages/contracts`
- 不要把 online query path 和 offline ingestion/data plane 混在同一层
- 不要把本机目录语义提升成长期对象存储真相源；当前阶段对象存储虽然可本机部署，但架构语义上仍是 `S3-compatible object storage`
- 任何实现都应先尊重已冻结的 contract 和 package 边界，再考虑 runtime 或框架便利性
- query-serving surface 由 collection runtime profile 显式控制；如需新增或收缩 serving
  surface，必须同步更新决策/计划文档并保持范围显式

### Architecture Over Patchwork

- 修复问题时，优先恢复正确边界和长期形态，不要默认选择最小改动
- 如果问题来自错误抽象、错误分层或错误 contract，优先修边界本身，不要在外围堆 patch
- 遵循第一性原理：先明确目标、不变量、source of truth、失败边界与真实约束，再设计实现；不得在未澄清
  根因和长期边界前，用经验性补丁、惯性模式或局部便利替代问题本身的正确解
- 除非用户明确允许，不得新增任何 fallback、兜底、降级、宽松兼容、best-effort、silent
  recovery、隐式默认成功、缺字段自动补全或“先给一个答案”的逻辑；遇到证据不足、contract
  不完整、配置缺失或状态不一致时，默认 fail closed，并把缺口暴露为可诊断问题
- 不得用 fallback/兜底逻辑掩盖 ingestion、retrieval、answer contract、authz、配置或部署链路的真实缺陷；
  应修复缺陷来源，或把缺失能力记录为明确 backlog，而不是在消费层猜测补齐
- 不要为了短期通过测试而新增临时兼容层、双路径逻辑、一次性适配层或“以后再删”的过渡代码，除非存在明确外部迁移约束
- 当实现方案和长期正确方案冲突时，默认选择长期正确方案；若选择兼容层，必须有明确外部依赖理由
- 不要沿着现有 hack 继续扩建；现有坏边界不是新增坏边界的理由
- `smoke`、`typecheck`、`build`、截图或 staging 可用性默认只是验证证据，不得反向定义实现策略；对于 donor
  transplant、产品壳迁移、边界纠偏和架构收口任务，不能因为“先跑通”而接受腐烂设计
- 这些规则不能作为误解、放大或改写用户原问题的理由

## Execution Protocol

### Working Rules

- 做结构性改动前，先读 `Source Of Truth` 中对应文档
- 优先在边界内修改；跨多个 package 改动时，先确认 `packages/contracts` 是否需要先冻结或先调整
- 设计或实现用户可见 UI、通用交互、框架能力、基础设施接入或非领域专属能力时，默认先评估成熟开源库、
  已采用 donor shell、现有依赖与开源组件是否能承担；优先复用而不是自研。只有当仓库安全 contract、授权边界、
  数据投影、领域语义或长期架构边界无法由通用库正确表达时，才新增自有实现，并显式说明为什么不能直接复用
  开源方案。
- 仓库当前默认处于验收收口 / 上线前硬化阶段；默认优先正确边界、发布质量、真实部署一致性与验收口径对齐
- 不做“未来也许会用到”的泛化设计；但除数据面或明确隔离的后置能力外，也不得把“先跑通”或“最小可验证闭环”当作前端 donor
  parity、产品壳迁移、架构纠偏或 runtime 收口任务的默认策略
- Node / Worker app 默认使用 `pnpm`，不再新增或维护 `package-lock.json`
- 如果变更触及长期边界、当前 accepted retrieval/data-plane 约束或对象存储/ingestion 不变量，同步检查相关
  `docs/architecture` 或 `docs/decisions` 是否需要更新
- 结构性改动必须遵守代码组织架构文档：按 owner / runtime boundary /
  domain responsibility 切分，不用机械拆文件绕过 gate，不把 helper 做成跨 owner
  垃圾桶，不把同一 DTO / schema / env projection / route exposure 跨层手写复制
- 不要在 repo 级 `AGENTS.md` 里写个人工作习惯、平台专属工具细则或一次性实验说明；这些内容应放到全局 agent 配置
- 在规则、架构、文档和实现设计层面，同样禁止用“最小改法”替代长期正确的结构性修正
- plain `codex` 默认用于讨论、review、问答、方案分析与执行；repo 不再维护自建
  workstream harness、lease/heartbeat 或 Codex hook 注入层
- 多人并发推进不同 workstream 时，默认用 GSD SDK 查询、切换和维护 workstream
  registry，例如 `gsd-sdk query workstream.list/status/set/progress --raw --cwd "$PWD"`；
  tracked planning truth 只保留 `.planning/PROJECT.md` 与 `.planning/WORKSTREAMS.md`，
  不要把本地会话状态写回 tracked planning 文档
- GSD SDK / Codex native workflow 的长期决策以
  `docs/decisions/adr-0046-gsd-sdk-and-codex-native-workflow.md` 为准；日常命令和场景路由以
  `docs/runbooks/workstream-gsd-sdk-workflow.md` 为准

### Git Commit Title Rules

- 默认使用 `Conventional Commit` 前缀加中文标题：`<type>: <中文结果描述>`
- 常用前缀保持语义清晰：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`
- 冒号后优先写中文结果描述，直接说明这次提交完成了什么，不写空泛过程词
- 标题优先使用动宾结构，例如：`添加`、`完成`、`修复`、`重构`、`明确`、`迁移`、`简化`、`调整`
- 需要补充阶段、任务号或关键上下文时，放在标题末尾括号内，不要喧宾夺主
- 默认参考仓库已有中文提交风格，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice +
  navigation_mode）`
- 避免使用纯英文或无信息量标题，例如：`init`、`init again`、`update stuff`

### Subagent Guidance

优先把可独立处理的子任务拆开处理，但前提是任务天然可并行、边界清晰、责任可分配。

- 先判断是否存在独立子任务；如果可以拆开，优先按模块边界委派，而不是把所有工作串行堆给主代理
- 优先按模块边界切分子任务，例如 `contracts`、`ingestion-core`、`retrieval-core`、
  `supervisor-agent-worker` / `knowledge`、`evals`
- 按依赖顺序并行，不要无视 contract 和强耦合关系；当前执行分批以 `.planning/` 中的 active phase/context/plan
  为准
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
pnpm web:lint
pnpm docs:lint
pnpm yaml:lint
pnpm decomposition:lint
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
```

JS/TS surface 的默认验证命令：

```bash
pnpm install
pnpm web:lint
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
- JS/TS app 的共享任务编排默认通过 repo root `pnpm` + `turbo` 入口执行，不再鼓励把跨 app
  验证拆回各自目录手动串行运行
- JS/TS lint 默认通过 root `pnpm web:lint` 执行，使用 Biome；Markdown lint 通过 `pnpm
  docs:lint` 执行；YAML 结构检查通过 `pnpm yaml:lint` 执行；Python lint/format 默认通过 `uv run
  --all-packages ruff ...` 执行
- repo-wide handwritten code/test 分解 gate 默认通过 `pnpm decomposition:lint`
  执行；新增或修改
  tracked handwritten `py/ts/tsx/js/jsx/mjs/cjs/go` code/test 文件时，不得超过 `800`
  行，也不得通过
  `configs/lint/decomposition-baseline.json` 新增 admission 回流
- `pnpm web:test` 是 JS/TS 默认稳定 gate；不要把它表述成自动覆盖所有 worker / integration lane
- `pnpm web:test:worker` 是显式 Worker runtime lane；`pnpm web:test:integration`
  是显式外部依赖 integration lane
- `apps/app-api` 默认 `pnpm test` 只跑 `test:node`；`test:worker` 与
  `test:shared-db-integration` 必须显式调用
- 如果新增局部测试或检查命令，只记录仓库里真实存在、可重复执行的命令
- 不要把“担心腐烂”当成替代验证证据的理由
- 当提出某种设计风险时，应尽可能区分：文档事实、代码事实，以及你的推断
- 上线前真实 staging E2E closeout 走
  `docs/runbooks/e2e-qa-release-runbook.md`；该 runbook 是 release QA 总入口，
  不替代 unit / typecheck / build，也不能用 fallback、兜底、
  `--expect-result-kind any` 或跳过 Access / auth / readyz 的方式标绿

## Repo Map

- `apps/execution-control`: Go-owned deterministic runtime/control-plane；负责
  execution admission、capability / policy gate、Temporal command/query/cancel、
  memory recall、RAG activity execution、provider usage/cost projection、Go
  finalization 与 runtime observability
- `apps/ingestion-worker`: ingestion runtime 壳；承接摄入任务，不负责在线回答编排
- `packages/knowledge-capability`: knowledge-family / RAG capability 的
  semantic specialist package；负责 retrieval planning、evidence verification、
  grounded synthesis、
  clarification 与 confidence 逻辑；不是 product entry、top-level router 或其他
  capability 的 source-truth owner
- `packages/prompt-runtime`: provider-facing prompt runtime；负责 prompt contract
  validation、Responses structured output execution、provider response
  normalization 与 prompt trace construction；不得通过 `packages/shared` 重新导出
- `packages/retrieval-core`: retrieval abstraction、evidence 获取与回链路径
- `packages/ingestion-core`: ingestion/data plane
  的逻辑消费层，负责去重、版本推进、解析、chunking、索引写入编排
- `packages/regulation-semantics`: regulations 领域语义 owner；负责 answer-ready evidence
  contract、answer role / condition / procedure taxonomy 与 regulation semantic registry
- `packages/contracts`: execution -> capability handoff、evidence bundle 与共享
  schema；不要泄漏运行时或基础设施类型
- `packages/evals`: 回归场景、基线与 smoke/eval 入口
- `packages/shared`: 轻量共享常量和 env/provider config helper；不要演变成业务逻辑、
  prompt runtime 或 provider transport 垃圾桶
