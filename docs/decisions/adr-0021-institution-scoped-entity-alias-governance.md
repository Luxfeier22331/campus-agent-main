---
doc_type: decision
status: accepted
created: 2026-04-02
updated: 2026-04-02
decision_id: ADR-0021
---

# ADR-0021：Institution-Scoped Entity Alias Governance

## 背景

`campus-agent` 当前已经为 `curriculum/curriculum_plan` 落地了第一版 alias 治理能力，但 repo-head 仍主要停留在：

- program title 的保守 resolve
- 少量 safe alias 的字符串规范化
- family alias 的 clarification-first 治理

这套机制已经足以覆盖：

- `民族班 -> 民族实验班`
- `基地班` 等 family alias 的 fail-close
- `大二下 -> 第四学期`

但它还不足以稳定支撑更日常的课程型问法，例如：

- `习概有哪些专业要上`
- `思政课有哪些专业要上`
- `思修课包括哪些课`

当前如果继续把 alias 扩展成更大的全局字符串替换表，会带来三个问题：

1. alias 不再表达实体，而只表达词面替换
2. 高歧义 alias 会继续偷偷坍缩成单目标 truth
3. retrieval / eval / answer shaping 无法共享稳定的解析终态

因此需要把 alias 从“字符串替换配置”升级为“institution-scoped entity resolution governance”。

## 决策

### 决策 1：alias 的长期对象是 canonical entity，不是 query 文本

长期上，alias 不再以“把用户 query 改写成另一段字符串”为目标，而是以“把用户表述解析到 canonical entity”为目标。

当前至少接受以下 entity type：

- `course`
- `course_family`
- `program`
- `semester`
- `cohort`

后续允许增加但当前未冻结：

- `offering_unit`
- `policy_object`
- `service`

直接含义：

- alias 解析结果应进入 agent 的 typed planning 语义
- retrieval 不直接消费 alias 文本真相，而是消费 canonical entity/filter truth
- eval 不再把高歧义 alias 的单目标 retrieval 排序结果当作 canonical truth

### 决策 2：alias 必须带 institution scope 和 intent scope

alias 不是 repo-wide 通用语义，必须带作用域。

长期上，每条 alias 至少应显式约束：

- `institution_scope`
- `corpus`
- `entity_type`
- `intent_allowlist`

示例：

- `习概 -> 习近平新时代中国特色社会主义思想概论`
  只在 `中央民族大学 + curriculum + course-centric intents` 生效
- `思政课 -> 思想政治理论课`
  只在 `中央民族大学 + curriculum + course family intents` 生效
- `思修课 -> 思想政治理论课`
  只在 `中央民族大学 + curriculum + course family intents` 生效

不允许的退化：

- 把 institution-scoped alias 当成所有学校通用词义
- 把 curriculum alias 漏到 handbook、service catalog 或其他 corpus

### 决策 3：alias 类型固定分层

长期上，alias 治理至少区分以下六类：

- `safe_alias`
  几乎无歧义、可直接单向映射到单一 canonical entity
- `family_alias`
  指向一个 entity family，而不是单一实体
- `scoped_alias`
  只有在显式 scope、major、program family 或其他约束下才成立
- `deprecated_alias`
  历史叫法、旧课程名或旧简称；命中后允许回到当前 canonical entity，但需要保留“旧称 -> 现名”的治理语义
- `pattern_alias`
  由规则产生，而不是手写枚举，例如口语学期、数字化课程简称等
- `forbidden_alias`
  高歧义或风险词，默认不允许进入 canonical resolved truth

当前 repo 已存在的 tiered alias config：

- `safe_alias`
- `family_alias`
- `scoped_alias`
- `forbidden_generic_alias`

应视为这套长期分层的第一版实现雏形，而不是最终数据模型。

### 决策 4：family alias 不得静默坍缩为单课或单 doc

对 family alias，长期固定以下规则：

- family alias 的 canonical target 是 `course_family` 或 `program_family`
- family alias 的默认完成态不是单目标 resolve，而是 `resolved_family` 或 `needs_clarification`
- 除非 query 本身已经显式指向某个单一成员，否则不得把 family alias 静默坍缩为单课或单 doc

对中央民族大学课程域，当前明确接受以下 institution-scoped family truth：

- canonical family：`思想政治理论课`
- family members：
  - `习近平新时代中国特色社会主义思想概论`
  - `马克思主义基本原理`
  - `毛泽东思想和中国特色社会主义理论体系概论`
  - `中国近现代史纲要`
  - `形势与政策`
  - `中华民族共同体概论`
- family aliases：
  - `思政课`
  - `思修课`

这里进一步冻结：

- `思修课` 在本项目里不是单课 alias
- `思修课` 也不是 repo-wide 通用 safe alias
- `思修课` 只在中央民族大学课程域中被接受为 `思想政治理论课` 的 institution-scoped family alias

### 决策 5：alias resolution 的 owner 在 rag-agent

长期 owner split 固定如下：

- `packages/rag-agent`
  拥有 alias/entity resolution、ambiguity policy、clarification policy 与 answer shaping contract
- `packages/retrieval-core`
  只消费 canonical entity/filter truth，不拥有 alias 治理语义
- `packages/ingestion-core`
  负责构建离线派生的 canonical entity facts，例如 course facts / family facts / audience facts
- `packages/evals`
  负责验证 alias resolution 的 deterministic truth 与 fail-close truth

直接含义：

- agent 可以做 entity-aware planning
- retrieval 不应再吸收“某个 alias 到底代表什么”的业务规则
- alias 不是 retrieval backend 的 query rewrite 插件

### 决策 6：resolution 终态固定为四类

长期上，alias / entity resolution 至少有以下四类终态：

- `resolved_single`
  query 已安全落到单一 canonical entity
- `resolved_family`
  query 已安全落到 entity family，但不应伪装成单一实体
- `needs_clarification`
  候选仍多于一个，或 family query 的 intent 需要进一步 disambiguation
- `rejected`
  命中 forbidden alias、缺乏稳定依据、或当前 serving surface 不支持

不允许的退化：

- 用 retrieval top1 代替 `needs_clarification`
- 用 profile memory 代替 `resolved_single`
- 用回答阶段的自然语言“补全”代替 `rejected`

### 决策 7：不同 intent 对 family alias 有不同完成合同

family alias 的完成合同不能一刀切。

对 `course_family`，当前至少冻结以下 intent contract：

- `course_family_membership`
  例如 `思政课包括哪些课`
  正确终态可以是 `resolved_family + completed`
- `course_audience`
  例如 `思政课有哪些专业要上`
  正确终态可以是 `resolved_family + completed`，但回答必须按 family audience 语义生成
- `course_schedule`
  例如 `思政课第几学期开`
  若不同 family member 的学期规则不同，允许返回结构化多课程答案，而不是捏成单值
- `course_offering_unit`
  例如 `思政课哪个学院开`
  若缺少稳定 `offering_unit` truth，可返回 partial answer 或 unsupported-subfield，不得猜测

### 决策 8：当前课程问答允许 partial answer，但禁止补猜未采集字段

对课程型 query，当前允许存在“部分字段可答，部分字段不可答”的终态。

当前阶段对课程 facts 固定接受：

- `audience/cohort/program` 可由现有培养方案和课程教学计划推导
- `offering_unit` 当前不视为稳定 truth，直到新数据源接入

因此当前接受的回答策略是：

- 如果问题只问 audience/program/cohort，则直接回答已证明字段
- 如果问题同时问 audience/program 与 offering unit，则允许 partial answer
- partial answer 必须显式说明未确认字段，而不是借模型补猜

示例：

- `习近平新时代中国特色社会主义思想概论有哪些专业要上`
  可以回答为：
  `根据当前已采集的培养方案和通识课程教学计划，可确认它面向所有本预科学生，而不是只面向少数几个专业。`
- `习近平新时代中国特色社会主义思想概论是哪个学院开的课，有哪些专业要上`
  当前正确终态是：
  `可以回答 audience/cohort，但必须明确说明开设学院当前缺少稳定依据。`

### 决策 9：长期目标是 alias -> canonical entity resolution -> entity-aware retrieval/filter -> deterministic answer policy

这条链路是长期不变量：

`alias -> canonical entity resolution -> entity-aware retrieval/filter -> deterministic answer policy`

它替代以下错误形态：

- `alias -> global string rewrite -> generic retrieval -> top1 answer`
- `alias -> profile memory collapse -> implicit truth`
- `alias -> free-form answer补完`

## 实施含义

对未来 `course-centric` 能力，这个 ADR 直接要求：

- 离线派生 `course_facts` / `course_family_facts`
- 在 agent 中形成 canonical course/course_family resolution
- retrieval 通过 canonical payload/filter 命中 facts collection
- answer shaping 根据 `resolved_single` / `resolved_family` / `partial answer` 语义输出

## 评测含义

canonical golden/eval truth 必须同步遵守：

- family alias 不得默认写成单目标 retrieval qrels
- `resolved_family` 可以是 completed truth，但 answer truth 必须按 family 语义书写
- mixed query 在缺 `offering_unit` truth 时允许 partial-answer truth
- forbidden claims 必须显式覆盖：
  - 不得猜学院
  - 不得把 `思政课` / `思修课` collapse 到任意单课

## 文档分层

- `docs/architecture/target-architecture.md`
  只记录 alias/entity resolution 的 owner boundary
- `docs/architecture/execution-and-agents-architecture.md`
  负责 agent 对 alias/entity resolution 的长期职责
- `docs/architecture/retrieval-serving-architecture.md`
  负责 retrieval 如何消费 canonical entity/filter truth
- `docs/reference/eval-gold-truth-model.md`
  负责 family alias / partial-answer 的 golden truth authoring 规则
- 本 ADR
  负责 alias/entity resolution 的长期治理、不变量与终态语义

## 状态

accepted
