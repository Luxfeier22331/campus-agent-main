---
doc_type: documentation_architecture
owner_boundary: docs
status: active
---

# 文档规范

## 用途

本文规定长期文档的分类、所有权、生命周期、命名和验证。它不保存功能进度、领域合同、命令
清单或发布结果。

## 核心规则

每条长期事实只有一个文档所有者。其他文档可以链接并说明读者为什么需要该链接，但不得复制
字段、默认值、操作步骤或同一结论。

代码、OpenAPI、JSON Schema、数据库 migration、注册表、配置和测试是当前实现的可执行来源。
它们与当前文档冲突时，应先确认代码行为，再修正文档；目标文档和 ADR 不能把未实现设计改写
成当前能力。

schema、fixture、配置或 `ToolSpec` 的存在不证明能力已经开放、发布或部署。环境状态以环境仓选择
和实际运行状态为准，源码仓文档不保存某次部署结果。

## 文档分类

| 读者问题 | 唯一所有者 | 内容边界 |
| --- | --- | --- |
| 产品是什么 | `docs/architecture/product.md` | 产品定位、用户和长期承诺 |
| 用户需要什么 | `docs/product/` | 场景、交互、非目标和验收 |
| 当前如何工作 | `docs/architecture/current.md`、`docs/architecture/system/` | 已合并拓扑、职责和数据流 |
| 长期收敛到哪里 | `docs/architecture/target.md` | 目标约束，不宣称已实现 |
| 某领域如何工作 | `docs/architecture/domains/`、`docs/domains/` | 领域边界、来源和开放能力 |
| 接口是什么 | `docs/contracts/` 与可执行 schema | HTTP、DTO、工具和运行合同 |
| 数据由谁维护 | `docs/data/` | 数据结构、来源、读模型和权限 |
| 为什么这样决定 | `docs/decisions/` | 重要选择、理由和替代关系 |
| 如何操作 | `docs/runbooks/`、`docs/environment/` | 部署、验证、恢复和环境输入 |
| 稳定参考是什么 | `docs/reference/` | 术语、矩阵和长期参考 |

README 只做模块入口、当前职责和常用本地命令索引，不复制所属文档正文。跨多个所有者的中央
流程图只展示连接关系；模块内部流程图留在所属架构文档。

## 生命周期

文档必须明确区分：

- 当前事实：已合入 `main` 且代码确实实现；
- 目标：已接受但尚未完整实现的方向；
- 未开放能力：代码或配置存在，但没有进入产品路径；
- 历史决策：用于解释当前选择的 ADR。

不建立迁移页、重定向文档、兼容说明页或 archive 目录。被完全取代且不再承载独立理由或外部
迁移约束的文档直接删除，历史由 Git 保留。ADR 的 `supersedes`、`superseded_by` 或
`partially_superseded_by` 可以保留被删除 ADR 的 ID，作为决策关系标识。

没有明确外部迁移要求时，文档不得要求恢复已删除 runtime、路由、字段、别名、隐式回退路径或双写。
仍在代码中使用的旧名称应按当前标识记录，不为未来假设设计兼容层。

## 冲突处理

1. 先确定问题属于产品、当前架构、目标、合同、数据、操作还是历史决策。
2. 查阅该类别的唯一所有者和可执行来源。
3. 当前行为以代码与可执行合同为准；文档错误直接修正。
4. 跨所有者接口变化时，先更新 OpenAPI、schema 或注册表，再更新实现和人类文档。
5. 同一精确数值只在合同或可执行配置维护；产品文档描述用户可见行为，架构文档描述边界。
6. 无法从当前代码证明的能力必须标为目标或未实现，不能使用现在时承诺。

## 语言与命名

- 仓库自有的标题、正文、表头和图表标签使用简体中文；
- 能用清晰中文表达时，不使用 `proof`、`closeout`、`truth`、`surface`、`seam`、`owner` 等
  英文黑话；
- 代码、命令、路径、环境变量、字段、schema、状态值、产品正式名称和外部引文保持原值，并用
  反引号或代码块标识；
- OpenAPI 与 JSON Schema 字段名保持原值，面向人的说明使用中文；
- 不维护同一内容的中英双份文档；GitHub Issue 与 PR 模板保持仓库既有协作格式；
- 文件名使用简短、稳定、可搜索的 ASCII 名称，不把日期、批次、状态或完整标题塞入文件名；
- 标题描述主题，不使用“最终版”“新版”“第一批”“收口”“完整方案”等过程词。

## 修改规则

- 修改前阅读最近的 README、所属架构、合同、数据文档和相关 ADR；
- 新文档只有在现有所有者无法容纳独立长期主题时创建；
- 删除文档前迁移仍有效的唯一事实和直接链接，不保留跳转页；
- 图表不得复制字段清单，并必须与正文表达同一方向和所有权；
- 操作手册不记录本次运行的时间戳、截图、私有地址、Secret 或外部平台导出；
- 文档不能把本地验证、PR 分支或部署清单存在描述成线上已运行事实。

## 验证

文档修改至少运行：

```bash
pnpm docs:check
git diff --check
```

涉及代码路径、命令、配置或 schema 事实时，再运行所属模块的定向检查。删除或移动文档后使用
`rg` 检查直接引用；不新增另一套自研文档 lint 来替代审阅。

## 相关文档

- `docs/README.md`
- `docs/architecture/current.md`
- `docs/architecture/product.md`
- `docs/architecture/target.md`
- `docs/architecture/system/code-organization.md`
- `docs/reference/verification.md`
- `docs/decisions/adr-0038-documentation.md`
