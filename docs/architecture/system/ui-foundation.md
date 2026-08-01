---
doc_type: architecture
owner_boundary: docs/architecture/system
status: active
---

# 界面基础与所有权

## 文档边界

本文规定仓库级界面基础的代码所有权和依赖边界。产品体验要求见
`../../product/ui.md`；页面信息、HTTP 合同和领域状态不由本文定义。

## 分层

| 层级 | 所有者 | 内容 |
| --- | --- | --- |
| 共享基础 | `packages/ui` | 语义 Token、Tailwind 映射、无业务语义的可访问控件 |
| 应用组合 | `apps/*` | 路由、页面布局、产品文案、查询状态、DataTable 和业务表单 |
| 领域界面 | 所属应用或领域包 | 问答、地图、阅读器、图表、tldraw 画布等专用交互 |

共享包通过 `@campus-agent/ui` 暴露 React primitive，并通过 `tokens.css`、`theme.css` 暴露样式
入口。消费应用负责导入 Tailwind、注册共享源码并按顺序导入共享样式；应用专属 Token 在共享样式后
覆盖或扩展。

## 共享包边界

共享包可以拥有：

- 画布、表面、文字、边框、交互、状态、焦点、圆角、阴影和控件状态等语义 Token；
- Button、表单字段、Badge、Card、Alert、Dialog、Sheet、Tabs、Select、Tooltip 和语义 Table 等
  无业务语义控件；
- `cn` 等只处理界面组合的纯函数，以及这些控件自身的类型和行为测试。

共享包不得拥有：

- 路由、导航内容、页面标题、产品文案或用户权限；
- 请求、采集、模型、记忆等状态枚举及其中文文案或 tone 判断；
- TanStack Query 状态、服务端排序、分页、游标、DataTable 查询行为或领域校验；
- Campus 的 chat、docs、map、dining Token，Ops 的数据图表 Token，或 Dining 编辑器的画布布局。

共享控件只接受 `neutral`、`info`、`success`、`warning`、`danger` 等视觉意图。领域模块先对合同
状态做穷尽映射，再调用共享控件；共享包不能通过字符串猜测状态含义。

## 成熟组件边界

- Tailwind v4 负责语义 Token 到工具类的映射，Radix 负责弹层、选择、折叠和 Tabs 等复合交互，
  Lucide 提供通用图标；
- TanStack Table、Virtual、Router 和 Query 留在使用它们的应用，不由共享包包装业务行为；
- HeroUI、assistant-ui、MapLibre、Recharts 和 tldraw 只在所属领域使用，并在集成边界适配
  共享语义；
- 语义 HTML 足以正确完成任务时不增加组件依赖；需要焦点限制、键盘状态机或浮层定位时必须使用
  成熟 primitive，不在应用内重新实现。

## 演进与验证

只有组件已被两个界面消费，或已经确定由第二个界面立即消费时才进入共享包。迁移调用方后删除原
重复实现，不建立跨应用兼容 re-export。

共享包用组件测试证明 ref、原生 disabled、字段关联和复合控件键盘行为；应用继续负责页面状态、
响应式旅途和浏览器无障碍验证。组件 API 和精确样式以 TypeScript、CSS 和测试为准，不维护第二份
组件目录或 Token 数值表。
