---
doc_type: architecture
truth_scope: product
owner_boundary: docs
status: active
created: 2026-04-05
updated: 2026-06-13
---
# Product Positioning

## 文档边界

本文负责定义 `campus-agent` 的产品定位与产品边界。

它回答的是：

- `campus-agent` 服务谁
- 它要解决什么问题
- 首先应被理解成什么产品
- 长期会扩展成什么产品
- 哪些形态明确不属于它的产品定位

它不负责：

- 当前 merged truth 拓扑快照
- 某一轮 phase 的执行顺序
- 某个 app / package 的实现职责
- 某个 agent、地图 SDK 或 provider 的具体技术选型

## 核心定位

`campus-agent` 是一个面向普通用户的 institution-scoped public campus
question-answering assistant。普通用户包括潜在考生、家长、校外访问者、学生与教职工；在当前产品边界内，
这些用户共享同一组已开放、成熟、只读的校园问答能力。

它的核心目标不是做一个通用聊天机器人，而是以受控 serving surface、明确 tool / domain boundary 和可追溯 institution
truth 为基础，持续承接高频校园问答、校园服务发现与后续校园地点寻找 / 导航场景。

长期上，`campus-agent` 是一个：

- shared control-plane 下的 multi-entry campus product
- Execution Agent Layer-led 的 tool-using campus assistant product
- 以公开 / 已整理的机构知识、校园服务与空间信息为核心能力面的校园问答入口体系

## 目标用户

`campus-agent` 的主要用户包括：

- `prospective_user` 需要了解学校、专业、制度、办事路径和基础校园信息的潜在考生或家长
- `public_visitor` 需要查询公开校园信息的未登录校外访问者
- `campus_member` 需要获取制度、培养方案、服务点位、后续校园导航能力的学生和教职工
- `operator` 需要通过受控后台、投影和可观测性能力维护产品运行面的校方运营人员

`operator` 是后台 ops persona，通过 Operator Console 消费受控运维后台能力，不是主问答
agent 的终端用户能力边界。operator / eval / ingestion / release 工作不进入用户 agent tool
surface。

## 要解决的问题

这个产品存在的直接业务背景包括：

- 校园高频问答长期依赖人工答疑群或人工客服，重复劳动明显
- 机构知识分散在手册、培养方案、官网页面和线下经验里，用户难以快速定位可信答案
- 校园服务点、办事入口和地点信息往往依赖熟人经验，不适合继续只靠自然语言 RAG 猜测
- 服务开放时间、临时停办/闭馆、班车/接驳车安排等运营信息经常散落在通知里；用户真正想知道的通常是“当前状态”，而不是自己翻 notice
- 长期上，校园内地点寻找、路线选择和位置相关 guidance 需要进入同一个产品体系与共享控制面，而不是与问答、文档、服务状态完全割裂

## 产品承诺

`campus-agent` 的产品承诺固定为：

- institution-scoped 优先回答学校范围内、可治理、可追溯的问题，而不是开放域泛化助手
- controlled surface 只在显式开放的 serving surface 和 admitted tool boundary
  内回答，不把未准备好的知识面伪装成“好像能答”
- fail-close 面对地点歧义、证据不足、source truth 缺失、能力未成熟或当前状态不可验证时，优先澄清、说明无法可靠确认或进入受控失败，而不是强行猜测
- productized tools / workflows 用稳定的 Execution Agent Layer / admitted tool set
  承接能力，不把产品长期形态退化成一个拼接临时 tools 的聊天壳
- shared entry-set experience 长期允许多个并列 browser surface 共同承接产品能力；`AI
  助手`、`文档站`、`服务状态`、`校园地图` 等入口可以独立存在，但它们必须共享同一产品边界、控制面与 institution truth

## 产品定位

`campus-agent` 首先应被理解为：

- 一个受控的校园知识问答产品
- 一个持续扩展到 campus service discovery、notice discovery、place finding 与
  wayfinding 的校园助理
- 一个由 shared control plane 约束多入口体验、tool readiness 与 institution
  truth 的 campus assistant product

产品初始重心是 institution knowledge question answering，但长期入口不应被理解成
`RAG-first` 或 `knowledge-only`。

产品能力扩展方向是：

- 先补 `place_lookup` / `place_finding`
- 后做 `route_planning` / `wayfinding`

因此，不应把 `campus-agent` 描述成单一校园导航产品；更准确的说法是，它是一个以校园问答为起点，
并明确把地点寻找与导航纳入产品边界的校园助理产品。

补充约束：

- 当前 merged truth 已从 chat-only / launcher model 转向 `campus-web` 学生侧主体验；
  chat 仍是核心能力，但不再单独定义产品总入口
- 当前 merged truth、已开放 serving surface 与具体 browser surface 拓扑由
  `current.md` 维护
- docs shell 自己的首页、collection 入口或局部导航，不自动上升为整个产品的顶层入口架构
- `campus.muc.wiki` 是学生侧 product entry surface；它提供校园应用入口、账号壳与
  same-origin browser seams，但不改变 query-serving truth 或 tool opening truth
- 既有 `muc.wiki` MediaWiki 继续作为 sibling legacy service 运营；campus-web 可以提供外部链接入口，
  不替代、代理、镜像或迁移 MediaWiki 页面内容、上传媒体或账号
- `internal_portal`、`wechat_official_account` 与 tool read model source/data
  stream 是长期输入与 control-plane truth 的一部分；除非显式开放，它们不自动上升为当前公开产品承诺
- 单个 surface 的内部信息架构不自动上升为整个产品的顶层入口架构
- source/data stream 只有在显式开放后才上升为公开产品承诺

## 长期产品形态

长期上，`campus-agent` 应稳定覆盖以下产品能力面：

- institutional knowledge question answering
- campus service discovery
- campus service status / operating-condition lookup
- campus notice discovery / canonical notice reading
- campus place finding
- campus navigation / wayfinding

这意味着它的长期产品形态不是单一 RAG 问答器，而是一个能把不同校园能力面纳入同一产品交互、同一请求治理和同一 operator control plane
的校园助理系统。

其中：

- 稳定制度、材料、流程类问题继续由受控知识面回答
- 服务开放状态、临时关闭、班车安排等结构化当前状态问题应由独立 domain tool 承接
- 用户明确在找通知、讲座、公示或结果原文时，应优先进入 notice discovery / canonical notice reading
  路径，而不是默认混入 generic RAG
- 普通 chat 的第一语义决策长期由 primary agent 在 admitted tool set 内完成，而不是默认把所有请求先压成
  `knowledge_query`

产品助手还必须能在不调用校园 tool 的情况下回答产品身份、能力边界、普通寒暄与澄清类问题。
这类 direct/no-tool answer 属于 first Execution Agent decision 的 terminal branch，
不是 `assistant_intro`、`product_meta`、`product persona` 或 `surface prompt profile`。
当 primary agent 识别到具体校园需求时，才调用对应 typed tool /
workflow signal 并进入对应 workflow path。

工具开放口径固定为 readiness-first，而不是身份分层：

- 普通用户默认共享同一组已开放、成熟、只读的 campus tools。
- tool opening gate 只表达 source truth、typed contract、evidence / fail-close、projection
  与 cancel / timeout readiness。
- account / session / quota、operator surface access 与 user-scoped memory binding
  由产品层治理；它们不表示学生 / 教职工 / 院系之间存在不同的主问答 tool 权限。
- restricted documents、内部受限材料、approval / HITL、预约 / 提交 / 支付 /
  工单等状态变更能力不属于当前主问答产品目标。

长期入口模型固定为：

- `multi-entry`
- `shared control plane`
- `cross-surface continuity`

直接含义：

- `AI 助手`、`文档站`、`服务状态`、`校园地图` 等能力可以作为并列独立入口存在
- 单个 surface 的内部信息架构不等于整个产品的总入口信息架构
- 某个能力以独立入口存在，不代表它拥有独立的 auth truth、request truth、operator truth 或 canonical
  domain truth

## 关于未来开放域能力

长期上的产品扩展，默认仍然指校园能力面的扩展，而不是静默转向开放域聊天产品。

产品边界固定为：

- 主产品路径继续保持 `institution-scoped`
- 不把“开放域 generalist / web 回答能力”视为默认产品组成部分
- 不允许在 campus path 内用临时 web fallback 替代 `out_of_scope`

如果未来产品明确接受开放域能力，它也必须作为单独 tool boundary 进入，而不是反向改写当前 campus assistant
的产品承诺。

## 明确不是什么

`campus-agent` 明确不是：

- 一个通用 open-domain LLM 聊天机器人
- 一个只返回检索片段的校园搜索框
- 一个把 Execution Agent Layer 退化成 inline tool router 的 agent 壳
- 一个默认依赖外部地图站跳转完成主要体验的产品
- 一个替代校园 ERP、OA 或事务系统的全栈业务系统
- 一个按学生 / 教职工 / 院系身份拆分普通问答权限的复杂授权系统
- 一个把 operator、ingestion、release、eval 工作包装成用户可调用 agent 工具的后台系统

## 与其他文档的关系

- 产品定位与产品边界：本文
- 当前 merged truth、当前拓扑与当前 serving
  surface：`docs/architecture/current.md`
- 长期系统形态与硬约束：`docs/architecture/target.md`
- primary-agent-first tool routing 与 surface tool
  policy：`docs/architecture/system/tool-routing.md`
- 产品/runtime supporting
  architecture：`docs/architecture/system/product-runtime.md`
- 导航 / wayfinding
  长期能力边界：`docs/architecture/domains/navigation/architecture.md`
- 文档 truth class 与冲突裁决：`docs/documentation-architecture.md`

因此：

- 当问题是“`campus-agent` 到底是什么产品、服务谁、不是谁”时，优先看本文
- 当问题是“实现状态和开放范围是什么”时，优先看 `current.md`
- 当问题是“长期架构边界怎样冻结”时，优先看 `target.md` 与对应 ADR
