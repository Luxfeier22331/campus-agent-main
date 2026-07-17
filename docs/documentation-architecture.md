---
doc_type: documentation_architecture
owner_boundary: docs
status: active
---

# 文档规范与事实所有权

## 文档范围

本文规定仓库各类长期事实由哪类文档维护、发生冲突时如何判断，以及新增、迁移和删除
文档时必须遵守的规则。它不判断具体功能是否完成，也不保存当前工作进度、命令清单或
领域 schema。

## 核心规则

每条长期事实只能有一个文档所有者。其他文档可以链接或简要解释，但不得重新定义。

文档中同时出现不同生命周期时，必须明确区分：

- **当前已合并事实**：当前 `main` 已接受并实现的状态；
- **已接受目标**：需要收敛到的方向，不代表已经运行；
- **保留但未开放的能力**：名称或配置存在，但尚未进入产品流量；
- **已退役历史**：仅用于解释为何不得恢复；
- **兼容名称或路径**：当前代码仍使用的旧标识，不是新工作的目标词汇。

schema、配置、fixture 或 `ToolSpec` 的存在不证明能力已对产品开放、已可查询或已完成
发布。

## 语言规范

- 仓库自有的人类可读正文、标题、表头和图表标签使用简体中文。
- 能用清晰中文表达的仓库自有概念不得改用英文黑话；代码标识应放在反引号中，并在首次
  出现时说明中文含义。
- 路径和文件名使用简短 ASCII。
- 代码、命令、路径、环境变量、API 字段、schema 标识、状态枚举、产品正式名称和 URL
  保持原值，并使用反引号或代码块标识。
- OpenAPI/JSON Schema 的字段名保持不变，面向人的 `title`、`description` 使用中文。
- 法定文本、上游版权声明和明确标注的外部引文可以保留原语言；仓库自有说明使用中文。
- 不维护中英双份正文。中文是当前唯一权威文档语言。
- GitHub Issue 和 PR 模板属于协作元数据，不适用 `docs/` 中文正文规则；保持仓库既有的
  英文模板与上游协作格式，除非另有独立决策。
- 规范性要求使用“必须、不得、应、不应、可以”；引用外部标准时可附 `MUST`、
  `MUST NOT`、`SHOULD`、`MAY`。

## 成熟文档模式

- Diataxis：tutorial、how-to、reference、explanation 按读者需求选用；runbook 属于
  how-to，reference 和大部分 contract 属于 reference，架构属于 explanation。
- MADR/Nygard ADR：`docs/decisions/` 记录重要决策、理由和替代关系。
- OpenAPI/JSON Schema：机器可执行合同优先于重复的字段表述。
- RFC 2119/8174：只在确实表达规范要求时使用规范性措辞。
- GitHub 模板：Issue 和 PR 模板属于协作元数据，不使用 docs frontmatter。

## 事实类别

| 类别 | 所有内容 | 默认位置 | 不得包含 |
| --- | --- | --- | --- |
| `product_truth` | 产品边界、用户、承诺与非承诺 | `docs/architecture/product.md` | 实现进度、发布输出 |
| `product_requirement` | 功能 PRD、用户体验和验收标准 | `docs/product/` | 当前架构、wire contract、操作步骤 |
| `current_truth` | 当前已合并拓扑和服务面 | `docs/architecture/current.md` | 待办、目标设计、分支进度 |
| `target_invariant` | 长期约束和不得回退的边界 | `docs/architecture/target.md` | 当前完成度、优先级、staging 结果 |
| `supporting_architecture` | 跨领域所有权和运行时语义 | `docs/architecture/system/` | 工作进度、领域来源细节 |
| `domain_architecture` | 领域、工具和来源架构 | `docs/architecture/domains/` | 主链完成度、跨领域所有权 |
| `domain` | 窄能力行为和开放边界 | `docs/domains/` | wire/data schema、runbook、工作状态 |
| `contract_truth` | HTTP、运行时、DTO 和工具合同 | `docs/contracts/` | 产品定位、路线图、操作步骤 |
| `data_truth` | 数据结构、来源和读取模型所有权 | `docs/data/` | 架构理由、操作步骤、规划状态 |
| `decision_record` | 架构决策、理由和替代关系 | `docs/decisions/` | 命令清单、动态 inventory |
| `operational_truth` | 部署、验证、恢复和环境规则 | `docs/runbooks/`、`docs/environment/`、`docs/policies/` | 产品承诺、架构完成定义 |
| `reference` | 术语、矩阵、基线和稳定参考 | `docs/reference/` | 活动进度、架构决策、操作步骤 |

## 事实判断

不同文档回答不同问题，不存在一条把 PRD、目标架构、当前实现和操作手册排成高低的全局
优先级。先明确问题，再读取对应所有者：

| 问题 | 文档所有者 | 必须核对的可执行事实 |
| --- | --- | --- |
| 产品是什么、承诺什么 | `product_truth` | 已公开产品入口和产品配置 |
| 某功能应交付什么 | `product_requirement` | 对应合同、测试和实现状态 |
| 当前 `main` 已经实现什么 | `current_truth` | 代码、schema、注册表、配置和所有者测试 |
| 当前环境实际运行什么 | 环境仓和运行状态 | 已选择的 revision、部署状态和服务探针 |
| 长期不得回退的边界 | `target_invariant` | accepted ADR 和现有所有者边界 |
| HTTP、DTO 或数据结构是什么 | `contract_truth`、`data_truth` | OpenAPI、JSON Schema、类型、迁移和合同测试 |
| 为什么接受某项设计 | `decision_record` | 决策当时的上下文和替代关系 |
| 如何部署、恢复或验证 | `operational_truth` | 当前命令、环境配置和工具输出 |

处理不一致时遵守以下规则：

1. 跨类别文档描述不同生命周期，不把差异误判成冲突；明确标注“当前”或“目标”。
2. 当前事实与可执行来源不一致时，以代码、schema、配置和测试为准，并立即修正文档。
3. 部署事实不能从源码或目标架构推断，只能从环境仓和实际运行状态确认。
4. 同类事实出现多个定义时，只保留一个所有者，其他位置改为链接或删除重复内容。
5. 无法验证的快速变化事实不得写成高置信度结论；长期文档只记录可核验的当前事实或已接受
   约束。

## 常见问题入口

- 产品是什么、不承诺什么：`docs/architecture/product.md`
- 某功能应向用户交付什么：`docs/product/`
- 当前已经合并什么：`docs/architecture/current.md`
- 长期架构必须满足什么：`docs/architecture/target.md`
- 某工具是否可用：对应领域文档和可执行合同
- 请求如何恢复、取消或重放：durable runtime 架构
- 为什么接受某条边界：对应 ADR
- 如何部署、验证或恢复：对应 runbook

## 主问答链完成定义

主问答链只按通用在线执行骨架判断：

```text
app-api -> execution-control -> Temporal -> memory recall
-> primary agent decision -> direct/no-tool finalization 或已开放工具分支
-> sanitized finalization projection
```

单个工具内容质量、notice/navigation 等领域成熟度、Ops Web、eval、staging 和
release 收尾不自动成为主链阻塞项，除非它们破坏上述通用骨架。它们分别由领域、评测和
操作文档判断。

## 证据术语

不得无修饰地使用 `evidence` 表示不同用途。应明确写成：

- `answer_grounding_evidence`：支持答案的来源、引用、检索内容和 grounding 结论；
- `release_closeout_artifact`：用于接受部署或发布的 staging、smoke、readiness 输出；
- `operator_diagnostic_evidence`：用于排查和评测的脱敏轨迹、步骤、指标或 trace 事实。

`proof` 不是事实类别。一次运行输出不能升级为长期架构或当前事实。

## 内容规则

- README 只做入口路由，不维护完整目录、清理记录或第二份所有者摘要。
- 本地流程图放在所属文档；只有跨多个所有者才能进入 `docs/architecture/flows.md`。
- 大文档只有在单一事实类别、单一主要读者需求和正确所有者下才能保留。
- `current_truth` 不写剩余缺口、后续工作、staging 结果或目标计划。
- `target_invariant` 不写当前完成度、P0/P1/P2、实现顺序或 release 输出。
- supporting architecture 不得扩张成拥有所有领域的总文档。
- 未合并的计划、待办和执行记录不得作为默认分支的长期文档。
- active/accepted 文档不得把 historical、superseded 或 deprecated 文档当作当前所有者。
- 具体内部 Markdown 引用必须指向存在的文件，路径不得跨行拆分。

## 命名与 frontmatter

- 目录表达文档类别，文件名只表达对象，例如 `product.md`、`transport.md`、
  `adr-0038-documentation.md`。
- 不为已重命名内部文档保留 redirect stub；迁移引用后让旧链接失败。
- 新增长期 `docs/` Markdown 使用：

```yaml
---
doc_type: <文档类别或现有类型>
owner_boundary: <所属应用、包、领域或 docs 边界>
status: <active | historical | proposed | accepted | superseded | deprecated>
---
```

`doc_type` 表达文档用途，`owner_boundary` 表达维护边界，`status` 只表达文档生命周期。
目录已经表达事实范围，因此不再维护重复的 `truth_scope`。创建和更新时间由 Git 历史提供，
不在 frontmatter 手工复制。GitHub 模板等协作元数据不使用此 frontmatter。

## 维护流程

1. 新增文档前先确认事实类别和现有所有者。
2. 先更新所有者，其他文档只迁移入口或简要说明。
3. 决策变化时更新 ADR 生命周期，不把新决策伪装成旧历史。
4. schema 或合同变化时先更新可执行来源，再更新正文。
5. 完成记录、一次性审计和实施快照由 git history 保存。
6. 删除没有唯一证据或迁移价值的历史正文，不维护清理清单。
7. 可自动判断的重复错误可以增加低误报检查；领域真相仍由所有者测试和评审负责。

验证入口：

- `pnpm repo:static`：Biome、Markdownlint、EditorConfig 文本卫生；
- `pnpm docs:check`：frontmatter、ADR identity、内部文档引用和中文正文检查；
- 所属应用或包测试：schema、合同和领域不变量；
- `pnpm ci:repo`：聚合仓库级文档检查。

## 相关文档

- `docs/decisions/adr-0038-documentation.md`
