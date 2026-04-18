---
doc_type: plan
status: deferred
created: 2026-03-28
updated: 2026-04-12
---

# Versioned History Query Foundation

## 当前状态

本文状态固定为 `deferred`。

原因：

- 显式 `current / historical / as_of / compare` 仍然属于 target architecture
- 但当前 repo 没有 active execution wave 在推进这条能力
- 当前真相应优先看 `docs/architecture/retrieval-serving-architecture.md` 与 `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`

## 目标

本文负责记录“版本化文档服务 / 历史版本查询”主题的文档交付与后续实施基线。

当前交付目标不是直接改代码，而是先把三件事分清：

- 当前现状是什么
- 长期目标形态是什么
- 后续实现需要补哪些能力边界

## 本轮交付范围

本轮只交付文档，不交付运行时代码。

本轮要完成：

- 补清当前 retrieval / data-plane 文档里的现状边界
- 新增长期 architecture 文档
- 新增冻结规则的 ADR
- 新增后续实施拆解文档
- 更新 docs 索引

## 当前现状

当前 repo 已经具备：

- 历史版本保留
- current truth 维护
- 默认只服务当前有效版本
- 多来源等价内容归并

当前 repo 尚未具备：

- 用户显式指定历史版本查询
- 按时间点查询
- 版本对比查询
- 独立 version-selection / version-resolution 运行时边界

## 后续实施任务

### Task 1: 请求协议增加版本模式

目标：

- 让 query path 能显式表达当前模式、历史模式、时间点模式和对比模式

建议交付：

- `current`
- `historical`
- `as_of`
- `compare`

至少需要的字段方向：

- `version_mode`
- `version_id` 或 `effective_at`
- `compare_with`

### Task 2: Registry 增加版本解析职责

目标：

- 让 registry 不只是存版本元数据，还能解析“应该查哪一个版本”

至少要支持：

- 当前有效版本解析
- 指定历史版本解析
- 按时间点解析有效版本
- 比较双方版本解析

### Task 3: Retrieval 增加版本范围过滤

目标：

- retrieval 不再只会查 current-serving documents
- 在显式历史查询模式下，能按解析后的版本范围执行 pre-filter

固定约束：

- 版本过滤必须发生在 retrieval candidate 阶段
- 不允许先全查再由回答层丢弃不需要的版本

### Task 4: Specialist 增加版本化回答语义

目标：

- 让回答层能区分 current、historical、as_of、compare 四类模式

至少要支持：

- 历史版本提示
- 时间点提示
- 版本对比输出结构
- 历史意图不充分时的澄清

### Task 5: Eval 增加版本化样本

目标：

- 为历史查询与版本对比建立最小可回归样本

至少需要的样本类型：

- 当前版本查询
- 指定历史版本查询
- 按时间点查询
- 新旧版本对比
- 历史意图不明确的澄清 case

## 本轮文档交付

### 新增

- `docs/architecture/retrieval-serving-architecture.md`
- `docs/decisions/adr-0014-versioned-document-serving-and-history-query.md`
- `docs/plans/versioned-history-query-foundation.md`

### 修改

- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/data-plane-architecture.md`
- `docs/reference/phase1-ingestion-retrieval-implementation-truth.md`
- `docs/README.md`

## 验收标准

完成后以下条件同时成立：

- 当前现状与长期目标不再混写
- “默认 current-serving” 与 “显式历史查询” 被清晰区分
- 多来源归并、历史版本保留、历史查询入口三者职责明确分开
- 后续如果要实现版本化查询，不需要重新从聊天记录中捞需求

## Deferred

以下内容明确延后：

- 请求协议和 contracts 的代码实现
- registry 版本解析代码
- retrieval 版本过滤代码
- specialist 历史回答和对比回答实现
- 版本化 eval fixture 与 gate 阈值
- UI / 产品交互设计
- 历史索引是否拆分为单独 archive index
