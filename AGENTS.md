# AGENTS.md

## Purpose

This file is the repository entry guide for coding agents. Keep it short,
practical and stable. Put detailed architecture, workflow and verification
guidance in `docs/` and link to it from here.

## Project Snapshot

- `campus-agent` is the v2 monorepo for the campus assistant system.
- `develop` is the long-lived integration branch. `main` is the stable branch.
- When discussing merged truth, default to the state already merged into
  `develop`. Feature worktree progress is not merged truth until merged.
- `apps/` contains long-running transport/runtime boundaries, `jobs/` contains
  one-shot or scheduled deployable runtime boundaries, and `packages/` contains
  stable tool/domain boundaries.
- Current forward student product surface is `campus-web`; `/docs/*` is the
  Rspress-powered canonical reader surface.
- `apps/app-api` is the Worker-owned shared browser-facing API surface.
- `apps/execution-control` is the Go-owned execution-control service. Temporal
  is the execution substrate. PostgreSQL stores sanitized run/event/step
  projections, not raw workflow truth.
- Online answer flow is primary-agent-first. Ordinary chat stays in the primary
  agent path; admitted `knowledge_query` uses the Go-owned RAG Temporal graph.
- Current model-visible tools are controlled by
  `configs/runtime/tools.v4.json`,
  `configs/runtime/tool-function-schemas.v1.json` and
  `configs/runtime/workflow-artifacts.v2.json`.
- Python `apps/supervisor-agent-worker` has been removed from the active
  workspace. Do not restore it as serving code.

## Branch And Worktree

- Work in the current feature worktree and branch unless the user explicitly
  asks to switch.
- Before editing, confirm the current worktree with `git status --short --branch`
  when there is any chance of parallel worktree confusion.
- Never revert user or other-worktree changes unless explicitly asked.
- Ignore unrelated dirty files. If they block the task, call out the conflict
  and work with the existing changes.
- Use `rg` / `rg --files` for search. Use `pnpm` for Node/Worker work.
- Do not add or maintain `package-lock.json`.

## Read First

Use targeted reading. Do not load every document by default.

- Repo overview and commands: `README.md`
- Documentation rules and truth classes:
  `docs/README.md`, `docs/documentation-architecture.md`
- Current merged architecture truth: `docs/architecture/current.md`
- Product scope: `docs/architecture/product.md`
- Target architecture: `docs/architecture/target.md`
- Code organization: `docs/architecture/system/code-organization.md`
- Verification lanes: `docs/reference/testing-and-verification-lanes.md`
- Release and staging QA: `docs/runbooks/e2e-qa-release.md`
- Workstream state: `.planning/PROJECT.md`, `.planning/WORKSTREAMS.md`
- GSD workflow: `docs/runbooks/workstream-gsd-sdk-workflow.md`

For domain work, read the closest relevant `docs/architecture/system/*`,
`docs/architecture/domains/*`, `docs/data/*`, `docs/contracts/*` or ADR before
changing structure or contracts.

## Hard Boundaries

- Do not treat `docs/architecture/target.md` as current merged truth.
- Do not treat local dev/test/deploy paths as architecture truth changes.
- Do not restore old bootstrap/tool-adapter patterns as the product entry,
  top-level router, hidden mega-agent or flat retrieval tool.
- Keep retrieval internals, index building and vector DB details out of the
  Execution Agent Layer and `packages/contracts`.
- Do not leak `Agno`, `LlamaIndex`, `Qdrant`, `MinIO` or other infrastructure
  types into `packages/contracts`.
- Do not mix online query path and offline ingestion/data plane ownership.
- Hindsight personal memory is consumed only through execution-control Temporal
  activities and sanitized projection. Do not expose raw memory ids or payloads
  to primary-agent model-visible tools, app-api contracts or browser responses.
- Campus services model-visible scope currently includes only
  `transport_schedule_lookup`; do not open broader service tools casually.
- `ToolSpec`, contract or JSON Schema existence does not make a tool
  model-visible. Runtime tool exposure must be opened in the runtime configs.
- Prefer mature existing libraries and existing repo primitives for UI,
  framework and generic infrastructure work. Add custom code only when repo
  contracts, authz, projections or domain semantics require it.

## Work Protocol

- First answer the user’s actual question. Do not turn deployment, local test or
  review questions into architecture debates unless the user asks for that.
- If the task is implementation work, read the relevant files and implement
  end-to-end within the current turn when feasible.
- Keep changes scoped to the requested owner/module. Do not do unrelated
  refactors while passing through a file.
- Structural changes must respect owner/runtime/domain boundaries from
  `docs/architecture/system/code-organization.md`.
- Cross-package contract changes should freeze or update `packages/contracts`
  before dependent implementations.
- Fail closed for missing contract, config, authz, evidence or deployment truth.
  Do not add fallback, best-effort, silent recovery or implicit success unless
  the user explicitly asks for it.
- Parallelize independent read-only inspection with `multi_tool_use.parallel`.
  Do not parallelize edits.
- Use `apply_patch` for manual tracked-file edits.
- For frontend changes, keep the first screen usable, respect existing design
  system conventions, ensure mobile text/layout do not overlap, and verify
  browser behavior when the change affects runtime UI.

## Verification Policy

- Match verification to the phase and blast radius.
- During implementation/exploration, default to local, relevant, repeatable and
  cost-controlled checks.
- Before PR, run the affected lint/typecheck/test/build lanes and report what
  passed and what was not run.
- Run real staging E2E, full E2E or release runbooks only when the user asks for
  release/staging validation, the task itself is CI/release governance, or the
  change is stable and being prepared for release closeout.
- Do not list release closeout as a normal feature’s current P0 implementation
  step.
- `pnpm repo:guard` checks collaboration/governance rules only. It is not
  runtime or E2E validation.
- Use `docs/reference/testing-and-verification-lanes.md` for exact lane meaning
  and commands.

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
  或扁平 retrieval tool；RAG 只能在已 admitted 的 `knowledge_query` path 内部承担
  retrieval planning、evidence verification、synthesis 与 grounding 语义
- 不要让 `Agno`、`LlamaIndex`、`Qdrant`、`MinIO` 或其他具体基础设施类型泄漏进 `packages/contracts`
- 不要把 online query path 和 offline ingestion/data plane 混在同一层
- 不要把本机目录语义提升成长期对象存储真相源；当前阶段对象存储虽然可本机部署，
  但架构语义上仍是 `S3-compatible object storage`
- 任何实现都应先尊重已冻结的 contract 和 package 边界，再考虑 runtime 或框架便利性
- query-serving surface 由 collection runtime profile 显式控制；如需新增或收缩 serving
  surface，必须同步更新决策/计划文档并保持范围显式
- `ToolSpec`、contract 或 JSON Schema 的存在不等于 model-visible；primary
  agent 可见工具必须同时被 `tools.v4`、`tool-function-schemas.v1` 和
  `workflow-artifacts.v2` 以当前 runtime posture 打开
- Hindsight personal memory 只能由 `apps/execution-control` 通过 Temporal activity
  和 sanitized projection 消费；不得把 Hindsight MCP、Hindsight direct tools、raw
  bank/document id 或 raw payload 加入 primary agent model-visible tool
  catalog、app-api product contract 或 browser-facing response。
  execution-control internal /
  operator diagnostics 可保留 repo-owned operation/document refs，但这些 refs
  不得透传到 student browser-facing run-step / profile-memory response
- campus services 的当前 model-visible 范围只包含 `transport_schedule_lookup`；
  generic service status、service guide、contact directory、academic calendar 与
  dining lookup 在正式 admission 前不得顺手打开

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

### Documentation Change Gate

提出或实施任何 repo 文档改动前，必须先判定文档对象的 truth class 与 canonical owner。

- 如果改动对象是 narrow capability，默认只能有一个 canonical human document；其他文档只能加索引、
  链接或极短路由说明，不得重复定义 capability truth
- 文档方案必须先给 doc map，列出 canonical owner document、每个 durable fact 的 owner、哪些文档只允许
  link-only，以及哪些相关文档明确不改
- 每个新增或修改的非 canonical 文档都必须回答：“这个事实为什么不能只链接到 canonical
  owner？”回答不上来就不改
- 不得把实现影响面等同于文档 ownership；代码可能触及多个 app/package，但文档事实不得因此散落到多个
  truth class
- ADR 只记录昂贵、长期、会被反复争论的架构决策；narrow capability 设计默认进入 canonical
  capability doc，不默认写 ADR
- Runbook 只承载操作步骤、smoke、恢复和故障分类；不承载 tool/domain 架构边界
- 修改前用 `rg` 搜索相关术语，确认不会制造重复定义

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
- 优先按模块边界切分子任务，例如 `contracts`、`app-api`、`campus-web`、
  `execution-control` / `toolreadmodel`、`agent-runtime`、`ingestion-core`、`evals`
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
- 如果某个 `apps/*`、`jobs/*` 或 `packages/*` 需要特殊工作流，可在对应目录新增更细粒度的
  `AGENTS.md`
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
pnpm repo:guard
pnpm repo:static
pnpm go:check
pnpm web:lint
pnpm web:typecheck
pnpm web:test
pnpm web:test:worker
pnpm web:test:integration
pnpm web:build
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
```

## Commit Style

- Use Conventional Commit prefixes with Chinese result descriptions:
  `feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`.
- Prefer verb-object titles, for example `docs: 精简 AGENTS 入口规则`.
- Avoid vague titles such as `update`, `misc`, `init`, `fix stuff`.
- Keep commits focused and do not mix unrelated formatting, refactor and
  behavior changes.

## Repo Map

- `apps/campus-web`: student web shell, account surface and Rspress docs reader.
- `apps/operator-console-web`: controlled operator browser surface.
- `apps/app-api`: Worker-owned shared browser-facing API and product proxy seam.
- `apps/execution-control`: Go execution admission, Temporal control, memory
  recall, RAG activities, finalization and runtime observability.
- `apps/agent-runtime`: OpenAI Agents SDK primary agent runtime.
- `apps/ingestion-control`: TS ingestion task control plane.
- `apps/ingestion-worker`: narrow Python extraction adapter island.
- `jobs/dining-sync`: dining data write job/cronjob.
- `packages/contracts`: shared execution/tool/evidence schemas without runtime
  infrastructure leakage.
- `packages/ingestion-core`: ingestion/data-plane logical consumer.
- `packages/ingestion-kernels-rs`: deterministic file-level ingestion kernels.
- `packages/regulation-semantics`: regulation answer-ready evidence semantics.
- `packages/eval-langfuse`: TS Langfuse eval adapter.
- `packages/ragas-runner`: narrow Python Ragas execution island.
- `packages/shared`: lightweight constants and env/provider helpers only.
