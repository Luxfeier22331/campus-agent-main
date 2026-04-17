---
doc_type: plan
status: deferred
created: 2026-04-06
updated: 2026-04-12
---

# Protected Panel Requests Triage Table Redesign

## 文档边界

本文只负责 `apps/protected-panel-web` 中 `Requests` 列表页的前向重构 handoff。

本文不负责：

- 修改 `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md` 已冻结的数据 ownership
- 把 panel 变成 log viewer、telemetry viewer、trace console
- 直接替代 `Requests` detail 页承担的深度排障职责

## 当前生命周期状态

- 本文仍是受控 panel `Requests` 分诊台重构的 accepted follow-up 方向，但当前没有独立 active execution wave
- 当前 repo 的默认 active lane 仍是 Phase 15 grounded-generation hardening；该 redesign 不应被误写成当前项目主线
- 如需恢复该重构，应在 `.planning/PROJECT.md` / `.planning/STATE.md` 中显式建新执行面，而不是继续把本文保留在默认 active 入口

## 现状问题

基于 staging 现网 MCP 检查，当前 `#/requests` 列表存在以下结构性问题：

- 它更像 request projection 的平铺表，而不是运维 triage table
- 真正高价值的分诊入口没有进入列表主视图
- 次级信息占据了默认列宽，主任务信号反而被压缩
- `List filters` 已定义，但顶栏 actions 被缩成纯导出，导致 filter button/form combo 实际不可见
- `aside` 常驻说明卡占用主内容宽度，进一步压缩表格
- 在窄视口下表格明显超宽，当前布局没有形成有意识的高密度策略

MCP 证据：

- `1100px` 视口下，当前 requests 表格宽度约 `1294px`
- 可见列表列为：
  - 请求
  - 主体
  - 接入面
  - 状态
  - 能力
  - 范围
  - 问题
  - 耗时
  - 开始时间
  - 查看
- 实际页面只暴露了一个常驻 `请求 ID` 输入框，未暴露 `状态` / `接入面` / `会话` 的交互入口

## 设计目标

把当前页面从“请求投影表”收敛成“请求分诊台”，满足以下目标：

- 让运维先扫异常，再决定是否进入 detail
- 默认展示高信号字段，而不是字段均匀平铺
- 提供稳定、直接的筛选入口
- 在不违反 panel/runtime boundary 的前提下，充分利用 `app-api` 已返回的列表字段
- 保持 detail 页继续承担深度诊断、观测和外链跳转职责

## 外部设计约束

本轮采用以下官方 guidance 作为交互约束：

- React-admin Filtering Tutorial
  - 默认 list filtering 形态是 inline filter form 加 filter button
  - quick filters 适合降低键盘输入依赖
  - saved queries 适合让用户保存 filter + sort 组合
  - https://marmelab.com/react-admin/FilteringTutorial.html
- React-admin DataTable
  - `ColumnsButton` 可让用户显示 / 隐藏 / 重排列
  - `hiddenColumns` 允许定义高价值默认列，同时保留可恢复的次级列
  - https://marmelab.com/react-admin/DataTable.html
- MUI X Data Grid
  - quick filter 与 column visibility 是数据表格基础能力
  - https://mui.com/x/react-data-grid/filtering/
  - https://mui.com/x/react-data-grid/column-visibility/
- Carbon Design System Data Table
  - toolbar 应承载全局表格动作、搜索、复杂筛选、导出、设置
  - expandable row 是承载次级详情的合法模式
  - https://carbondesignsystem.com/components/data-table/usage/
- GOV.UK Table
  - table 应服务于“比较行列信息”，不能退化成页面排版容器
  - https://design-system.service.gov.uk/components/table/

## 列表与详情职责切分

### 列表页负责

- 批量扫描请求
- 快速发现异常 / 高优先级请求
- 提供按状态、时间、主体、范围、关键字的收敛路径
- 决定是否进入 detail

### 详情页负责

- 展示 request projection 全量快照
- 展示 observability、audit summary、trace / issue links
- 展示 source doc、diagnostics 与解释性信息

## 默认信息架构

列表默认列应调整为：

- 开始时间
- 状态
- 问题摘要
- 主体
- 目标 / 范围摘要
- 结果 / 异常摘要
- 耗时
- 查看

以下列应转为默认隐藏，但允许用户按需恢复：

- 请求 ID
- trace ID
- 会话 ID
- 接入面
- 能力

原因：

- `接入面` 在当前 staging 数据中高度同质，默认展示收益低
- `能力` 在当前数据中高度同质，默认展示收益低
- `请求 ID` / `trace ID` 是排障键，不应成为主扫描列
- `问题摘要`、`状态`、`异常摘要` 才是运维第一眼要看的信息

## 分诊优先级

默认排序继续使用 `startedAt DESC`，但视觉优先级应转为：

1. 状态 / 异常
2. 问题摘要
3. 主体
4. 范围 / 目标
5. 耗时 / 时间

具体要求：

- 状态保持 chip 呈现
- 异常摘要以单独列展示，而不是只在详情页出现
- 问题摘要保留 2 行 clamp，不再退化成窄列
- 主体采用“主标签 + 次级 ID”双层显示

## 顶部工具栏

当前 `TopToolbar` 只剩导出，必须重构为 triage toolbar。

最小目标：

- 搜索输入
  - 默认支持 `requestId` / 问题文本的快速检索
- 状态筛选
  - 作为常驻 quick filter 或显式筛选控件
- 时间排序
  - 保留默认按开始时间倒序
- 列设置
  - 支持隐藏 / 恢复次级列
- 导出

本轮不要求一次补齐 saved queries，但工具栏结构应为后续加 saved queries 留出位置。

## 版面规则

- requests 列表页不再常驻右侧 `aside`
- “查询语义”说明改为列表顶部折叠说明或头部 alert
- 主表获得完整横向空间
- 小视口下允许横向滚动，但默认列组合必须在常见桌面宽度下可读

## 本轮前端可直接落地的信号

不改 `app-api` list payload 前，前端已经可以直接利用：

- `status`
- `questionPreview`
- `answerPreview`
- `errorCode`
- `durationMs`
- `principalLabel`
- `principalId`
- `requestedScope`
- `selectedTarget`
- `sourceDocIds.length`
- `diagnostics`

因此本轮列表可新增的“结果 / 异常摘要”至少应覆盖：

- 错误代码
- 是否命中来源文档
- 是否存在待澄清 / 无法回答 / 已拒绝等终态
- 必要时展示 diagnostics 派生标签

## 后续需要 app-api 补充的列表信号

如果要把 requests 页进一步升级成强 observability triage table，后续应考虑在 list payload 中补：

- `emptyRecall`
- `citationMissing`
- `retrievedSourceCount`
- `failClosed`
- `aclAnomalyCode`
- `latestTerminalCode`
- `traceAvailable`
- `projectionLagMs`

这些信号当前存在于 observability/detail，而不在 list payload 中；本轮不通过 panel side 拼接或 sink side 反查绕过 app-owned truth。

## 实施顺序

### Wave 1：列表骨架重构

- 移除常驻 `aside`
- 替换当前请求列表列顺序
- 增加 triage toolbar
- 恢复/显式暴露筛选入口

### Wave 2：高信号单元格

- 重做“主体”单元格
- 重做“问题摘要”单元格
- 新增“结果 / 异常摘要”单元格
- 把低收益列转为默认隐藏

### Wave 3：细节与可配置性

- 支持列显示/隐藏
- 保持中文 copy 完整覆盖
- 收紧窄视口布局与可读性

## 验证标准

至少满足以下结果：

- requests 页在 staging 桌面宽度下不再表现为“信息平铺表”
- 运维可直接在列表页完成状态筛选与异常初筛
- 默认列能在一屏内清晰读到问题摘要、状态、主体与结果信号
- 详情页继续保留深度观测信息，不发生职责倒灌
- 不破坏 `app-api` request projection ownership 边界
