---
doc_type: architecture
status: active
created: 2026-04-05
updated: 2026-05-02
---
# Product Positioning

## 文档边界

本文负责定义 `campus-agent` 的产品定位与产品边界。

它回答的是：

- `campus-agent` 服务谁
- 它要解决什么问题
- 当前首先应被理解成什么产品
- 长期会扩展成什么产品
- 哪些形态明确不属于它的产品定位

它不负责：

- 当前 merged truth 拓扑快照
- 某一轮 phase 的执行顺序
- 某个 app / package 的实现职责
- 某个 agent、地图 SDK 或 provider 的具体技术选型

## 核心定位

`campus-agent` 是一个面向学生、教职工和潜在考生的 institution-scoped campus assistant。

它的核心目标不是做一个通用聊天机器人，而是以受控 serving surface、明确 capability boundary 和可追溯 institution
truth 为基础，持续承接高频校园问答、校园服务发现与后续校园地点寻找 / 导航场景。

长期上，`campus-agent` 是一个：

- shared control-plane 下的 multi-entry campus product
- supervisor-led 的 multi-agent orchestration product
- 以受控机构知识、校园服务与空间信息为核心能力面的校园入口体系

## 目标用户

`campus-agent` 的主要用户包括：

- `prospective_user` 需要了解学校、专业、制度、办事路径和基础校园信息的潜在考生或家长
- `public_visitor` 需要查询公开校园信息的未登录校外访问者
- `campus_member` 需要获取制度、培养方案、服务点位、后续校园导航能力的学生和教职工
- `operator` 需要通过受控后台、投影和可观测性能力维护产品运行面的校方运营人员

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
- controlled surface 只在显式开放的 serving surface 和 capability boundary
  内回答，不把未准备好的知识面伪装成“好像能答”
- fail-close 面对权限不足、地点歧义、证据不足或真相层缺失时，优先澄清、拒答或说明边界，而不是强行猜测
- productized capabilities 用稳定的 supervisor / agent capability family
  承接能力，不把产品长期形态退化成一个拼接临时 tools 的聊天壳
- shared entry-set experience 长期允许多个并列 browser surface 共同承接产品能力；`AI
  助手`、`文档站`、`服务状态`、`校园地图` 等入口可以独立存在，但它们必须共享同一产品边界、控制面与 institution truth

## 当前产品定位

在当前阶段，`campus-agent` 首先应被理解为：

- 一个受控的校园知识问答产品
- 一个以 shared `app-api`、public chat surface、public docs surface 和 protected
  operator surface 组成的前向产品雏形
- 一个正在从 handbook / curriculum 问答扩展到 campus service discovery 与 place finding
  的校园助理

当前公开能力重心仍然是 institution knowledge question answering。

这表示当前 rollout 的公开重心仍在 knowledge path，而不是长期入口必须始终 `RAG-first`。

当前已进入公开查询面的重点仍以：

- `student_rules`
- `curriculum_plan`

为主。

同时，已冻结的前向扩展方向是：

- 先补 `place_lookup` / `place_finding`
- 后做 `route_planning` / `wayfinding`

因此，当前不应把 `campus-agent`
描述成“已经上线的校园导航产品”；更准确的说法是，它是一个已经具备校园问答主路径、并明确把地点寻找与导航纳入产品边界的校园助理产品。

补充约束：

- 当前 merged truth 仍是“chat 为最成熟公开入口、docs 为已独立落地 surface、其他入口尚未 rollout”
- 这不等于长期产品必须维持“chat 作为唯一总入口”的 IA 真相
- docs shell 自己的首页、collection 入口或局部导航，不自动上升为整个产品的顶层入口架构
- `hub.muc.wiki/[slug]` 是新的 app-set product entry surface；它提供平面入口、
  账号壳与跨 surface 导航，但不改变 query-serving truth 或 capability opening truth
- 既有 `muc.wiki` MediaWiki 继续作为 sibling legacy service 运营；hub 只提供外部链接卡片，
  不替代、代理、镜像或迁移 MediaWiki 页面内容、上传媒体或账号

## 长期产品形态

长期上，`campus-agent` 应稳定覆盖以下产品能力面：

- institutional knowledge question answering
- campus service discovery
- campus service status / operating-condition lookup
- campus notice discovery / canonical notice reading
- campus place finding
- campus navigation / wayfinding
- identity-aware and authorization-aware campus assistance

这意味着它的长期产品形态不是单一 RAG 问答器，而是一个能把不同校园能力面纳入同一产品交互、同一请求治理和同一 operator control plane
的校园助理系统。

其中：

- 稳定制度、材料、流程类问题继续由受控知识面回答
- 服务开放状态、临时关闭、班车安排等结构化当前状态问题应由独立 domain-agent 承接
- 用户明确在找通知、讲座、公示或结果原文时，应优先进入 notice discovery / canonical notice reading
  路径，而不是默认混入 generic RAG
- 顶层 supervisor 长期应先做 capability routing，而不是默认把所有请求先压成 knowledge / `rag-agent`

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

当前固定结论是：

- 主产品路径继续保持 `institution-scoped`
- 不把“开放域 generalist / web 回答能力”视为当前已接受的产品组成部分
- 不允许在 campus path 内用临时 web fallback 替代 `out_of_scope`

如果未来产品明确接受开放域能力，它也必须作为单独 capability boundary 进入，而不是反向改写当前 campus assistant
的产品承诺。

## 明确不是什么

`campus-agent` 明确不是：

- 一个通用 open-domain LLM 聊天机器人
- 一个只返回检索片段的校园搜索框
- 一个把 supervisor 退化成 inline tool router 的 agent 壳
- 一个默认依赖外部地图站跳转完成主要体验的产品
- 一个替代校园 ERP、OA 或事务系统的全栈业务系统

## 与其他文档的关系

- 产品定位与产品边界：本文
- 当前 merged truth、当前拓扑与当前 serving
  surface：`docs/architecture/current-architecture.md`
- 长期系统形态与硬约束：`docs/architecture/target-architecture.md`
- capability-neutral routing 与 surface capability
  policy：`docs/architecture/system/capability-routing-and-admission-architecture.md`
- 产品/runtime supporting
  architecture：`docs/architecture/system/product-runtime-architecture.md`
- 导航 / wayfinding
  长期能力边界：`docs/architecture/domains/navigation/architecture.md`
- 当前 phase、pending work 与执行状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`
  与对应 workstream `STATE.md`

因此：

- 当问题是“`campus-agent` 到底是什么产品、服务谁、不是谁”时，优先看本文
- 当问题是“当前已经做到哪、当前开放了什么”时，优先看 `current-architecture.md` 和 `.planning/`
- 当问题是“长期架构边界怎样冻结”时，优先看 `target-architecture.md` 与对应 ADR
