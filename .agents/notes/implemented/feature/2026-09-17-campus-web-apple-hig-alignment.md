# Agent Note: campus-web apple hig alignment

Status: implemented

## 背景

campus-web 在移动端存在一组 Apple HIG 交互缺口：点按灰块与双击缩放延迟、页面文本被长按选中、
弹层滚动链穿透、viewport 未覆盖安全区、楼层图禁用了双击缩放、表单选择器使用自定义弹层、
sheet 无拖拽关闭。食堂是首个对齐目标，但基线改动落在 packages/ui 与全局文档头部，惠及全部页面。

## 决策

Campus 与 Ops 的确认框、浮层、状态、字段、操作组和卡片共用 UI primitives。
ConfirmDialog 只拥有展示与焦点行为，请求、错误及成功关闭由应用拥有；删除触发项时使用稳定焦点目标。
迁移移除 Campus 重复菜单/状态实现与 Ops ConfirmAction，保留领域布局及技术诊断。

- 触摸与焦点基线进 `packages/ui/src/theme.css`：`-webkit-tap-highlight-color: transparent`、
  `text-size-adjust: 100%`，交互控件 `touch-action: manipulation` + `user-select: none`；
  只读 Input（`packages/ui/src/form.tsx`）用边框高亮替代焦点环，取代此前食堂分享链接的局部补丁。
- `apps/campus-web/index.html` 声明 `viewport-fit=cover` 与明暗 `theme-color`；底部锚定 UI
  （兴趣社群返回顶部 FAB、Sheet bottom 变体）补 `env(safe-area-inset-bottom)`。
- Dialog、AlertDialog、Sheet 及食堂两个 sheet 的滚动主体加 `overscroll-contain`。
- 动效 token 增加 `--motion-duration-slow` 与 `--motion-easing-spring`；
  `prefers-reduced-transparency: reduce` 时关闭 backdrop 模糊。
- 移动端弹层换底部级交互：packages/ui 新增 vaul Drawer 原语（拖拽把手、safe-area 底距、
  spring 动效），campus-web 的 `AdaptiveSheetSurface` 按 1024px 断点在
  Drawer（移动）/右侧 Sheet（桌面）间切换，滚动主体标记 `data-vaul-no-drag` 防误关。
  两者都基于 Radix Dialog，aria 合同、Escape、焦点归还不变。
- 楼层图启用双击缩放（reduced-motion 时禁用），容器 `touch-none`。此条已被
  [食堂地图阅读、手势与往返导航](../bug-fix/2026-09-18-dining-map-navigation.md)部分取代；其余决定仍有效。
- 表单内选择控件（举报原因）经 `AdaptiveSelect` 在移动端渲染原生 select，桌面端保持 Radix Select。

## 未采用方案

- 不自研指针拖拽实现，直接引入 vaul。
- 不把桌面端右侧 Sheet 一并改成底部 Drawer：桌面保留既有布局，只对齐移动端缺口。
- 食堂大厅筛选（移动端 Radix Select 弹层）暂不原生化：它是筛选控件而非表单，
  现有 e2e 合同按 Radix 交互编写且当前无失败，留待真实反馈再评估。

## 后果

- 移动端触控无灰块与缩放延迟，弹层内滚动不再拖动页面，Home 指示条不再遮挡底部操作。
- e2e 基线（5 视口 × 16 用例）全部通过；合并 main 带来的两处既有回归随本批修复：
  交通页分段 Tabs 无 TabsContent，`aria-controls` 改指真实结果区
  `campus-transport-results`；AuthDialog 迁移后补回 `data-campus-account-surface="auth-modal"`。
- 单测 293（campus-web isolated）+ 456（fast）+ 70（packages/ui）全绿；typecheck、Biome 通过。

## UI 控件边界

- 共享输入、选择和复合搜索控件只保留一套边框职责；独立控件由自身绘制边框，复合控件由外层容器绘制。
- 控件焦点保留可见 ring，但不再使用额外 ring offset 形成第二层边线；全局 focus outline 仍作为未覆盖元素的兜底。
- Button、Disclosure 和账户菜单沿用同一 focus ring 规则；弹层、Field、Alert 和列表原有语义合同保持不变。

### 焦点环常量与使用规则（2026-10-20 收敛）

ring 此前散落在 5 个 UI 原语与 17 处应用层手抄串里，且地图组件用 `ring-[var(--campus-focus-ring)]`
绕过 token。现收敛为 `packages/ui/src/control-styles.ts` 导出的两个常量（`focusRing` 外环 /
`focusRingInset` 容器内环），原语与应用层统一引用：

- 独立交互控件（Button、Checkbox、Disclosure、卡片链接、列表行、地图浮层按钮）用 `focusRing`。
- 容器内条目（Tabs 触发器、菜单项、分段控件、账号菜单项）用 `focusRingInset`。
- 填充式复合控件（食堂搜索框）用表面变化表达焦点，不加 ring；文本输入自带 caret 可豁免环，
  其余交互元素必须有环或 ≥3:1 的状态变化（无障碍底线）。
- 覆盖共享焦点样式时必须对齐伪类特异性：`SelectTrigger` 自带 `enabled:hover:border-ring` 是双伪类，
  单伪类覆盖会被压制。
- 保留不动：vendored sidebar（独立 `--sidebar-ring` token）、theme-mode-control 的
  `peer-focus-visible:`（peer 前缀，常量不适用）、兴趣社群 FAB/头像的 `ring-1` 细环（次要控件的
  有意变体）、theme.css 的 base `:focus-visible` outline（安全网兜底）。
- `--color-ring` 被 campus-web 覆盖为 `--campus-focus-ring`（灰）是有意的主题化机制，两个 app
  可各自定制环色，不是债务。
