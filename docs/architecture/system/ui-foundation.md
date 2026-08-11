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

## 语义 Token 与主题所有权

`packages/ui/src/tokens.css` 是共享语义 Token 的唯一实现来源，按画布、表面、文字、边框、品牌身份、
交互 tint、链接、选中、状态、间距、圆角、阴影和控件尺寸分组，并为浅色与深色提供同一组变量。
品牌身份、主操作、链接、选中和状态不得互相作为别名。`theme.css` 只负责把这些变量映射为 Tailwind
语义类和全局基础样式；应用不得重新声明同名共享变量。

主题运行时由 `ThemeProvider`、`ThemeModeControl` 和紧凑入口 `ThemeModeMenu` 维护，入口 HTML 通过轻量
bootstrap 在客户端
hydration 前设置根节点外观。Provider 的首次 React 树保持可预渲染，bootstrap 不参与业务请求，也不
承担服务端主题判断。用户切换到不同的实际明暗主题时，Provider 使用浏览器 View Transition 对根
快照做一次短淡入淡出，并在同一提交中更新根 Token 与 React context；首次同步、实际明暗未变化、
浏览器不支持该能力或用户要求减少动态效果时立即切换。快速连续选择会停止旧 transition，只提交
最后一次选择。`packages/ui` 只拥有外观模式状态，页面仍由应用拥有路由、内容和领域状态。

应用在根布局声明 `data-ui-profile="campus"` 或 `data-ui-profile="ops"`，仅覆盖页面边距、控件高度、
表面圆角等密度变量。profile 不能改变共享颜色语义，也不能让业务组件依赖另一个应用的变量。

`status-web` 是独立的静态 Worker 页面，不接入共享 React primitive；它在应用层实现产品可用性状态行、
时间线和原生移动导航。其密度规则为状态/数据行 `12px`、控件 `8px`，并使用与共享语义一致的颜色、焦点和
主题要求。状态页 header 只复刻 Campus 产品导航的顺序和 active 语义，不把 `CampusTopNav` 或产品导航内容
迁入 `packages/ui`，也不引入账号状态。30 天时间线不作为共享 Card 或全局表格模式，也不改变现有 Campus/Ops
页面的圆角数值；每个服务的 30 天时间线使用一个复合 `role="slider"`，单一 Tab 停靠点和
`aria-valuemin/max/now/text` 表达日期选择，30 根竖条仅作 `aria-hidden` 视觉子元素；日期用窄竖条和焦点轮廓表达，
不在服务行内部再嵌套独立卡片。页面 H1 后直接渲染 `campus.qa` 与 `campus.services` 两行，不建立产品分组层；
初始骨架复用两行的稳定尺寸。时间线与图例同时使用实心、横向空隙、点线或虚线轮廓编码状态，不能只依赖颜色。

领域界面在集成边界消费应用 Token：Campus 地图的 MapLibre style、浮层和 marker 由
`apps/campus-web/src/design/tokens.css` 拥有，`MapPage` 在解析主题变化后重新加载 style，并在旧
style 与新 style 之间把 canvas 淡出到地图背景，等待 `style.load` 后再淡入；Ops Dining
Studio 的编辑器外层和 tldraw portal 由 `editor.css` 拥有，`TldrawEditor` 的 `colorScheme` 与
`tl-theme__light/dark` 保持一致。领域 Token 可以表达地图或画布特有的颜色，但不得覆盖共享文字、
边框、焦点和状态语义，也不改变领域数据流。

Campus Web 把共享基线放在 `src/campus-styles.css`，应用与静态文档复用该文件，但各自拥有独立入口。
应用入口 `src/app-styles.css` 保持以下顺序：

```css
@import "tailwindcss";
@import "@heroui/styles";
@import "@better-auth-ui/heroui/styles";
@import "./campus-styles.css";
```

HeroUI 及 Better Auth UI 样式在应用首帧确定性加载，随后由 `app-styles.css` 把其通用变量映射到共享
语义 Token；React 账号实现仍可按需加载。登录、注册和邮件旅途使用 Campus 自有表单，Better Auth UI
只组合已登录账号设置；账号设置在应用作用域内使用 Campus 控件高度、表面和圆角，并关闭产品尚未
提供存储合同的头像编辑。不再维护认证专属全局集成样式。组件文件不得再次导入全局 HeroUI 样式。

静态文档入口 `src/styles.css` 只导入 Tailwind 和 `campus-styles.css`，不包含 HeroUI 或账户集成样式，
以保持文档制品边界和既有 `/src/styles.css` 链接合同。

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

产品导航属于应用组合。Campus 的共同导航、工作区导航、地图沉浸导航和聚焦页头由
`apps/campus-web` 组合共享 primitive；它们不能进入 `packages/ui`，也不能由问答、文档或地图领域
各自复制一套产品链接与主题控件。

## 浮层编排与焦点

一次用户旅途中的 Sheet、Dialog、Popover 等浮层由最外层组合组件拥有打开状态和关闭后的下一步。
从一个模态浮层进入另一个模态浮层时，先请求来源浮层关闭，并在 primitive 的关闭生命周期回调
确认其焦点限制已经释放后再挂载目标浮层；任一时刻只能存在一个活动模态浮层。不得在来源浮层的
惰性子组件里再创建目标 Dialog，也不得用固定延时猜测退出动画何时结束。

关闭后的焦点按原因处理：Escape、关闭按钮和遮罩取消返回来源触发器；移动导航完成路由跳转后聚焦
新页面的主要内容；连续浮层先让目标浮层聚焦首个任务字段，目标关闭后再返回最初触发器。惰性组件
可以通过意图回调把登录等动作委托给组合所有者，但不能同时保留内部与外部两套浮层状态。

共享控件只接受 `neutral`、`info`、`success`、`warning`、`danger` 等视觉意图。领域模块先对合同
状态做穷尽映射，再调用共享控件；共享包不能通过字符串猜测状态含义。

## 成熟组件边界

- Tailwind v4 负责语义 Token 到工具类的映射，Radix 负责弹层、选择、折叠和 Tabs 等复合交互，
  Lucide 提供通用图标；
- TanStack Table、Virtual、Router 和 Query 留在使用它们的应用，不由共享包包装业务行为；
- HeroUI 提供账号浮层 primitive，Better Auth UI 只用于已登录账号设置；assistant-ui、MapLibre、
  Recharts 和 tldraw 只在所属领域使用，并在集成边界适配共享语义；
- 语义 HTML 足以正确完成任务时不增加组件依赖；需要焦点限制、键盘状态机或浮层定位时必须使用
  成熟 primitive，不在应用内重新实现。

## 演进与验证

只有组件已被两个界面消费，或已经确定由第二个界面立即消费时才进入共享包。迁移调用方后删除原
重复实现，不建立跨应用兼容 re-export。

共享包用组件测试证明 ref、原生 disabled、字段关联和复合控件键盘行为；应用继续负责页面状态、
响应式旅途和浏览器无障碍验证。组件 API 和精确样式以 TypeScript、CSS 和测试为准，不维护第二份
组件目录或 Token 数值表。新增共享控件前先确认至少两个消费方或一个已确认的立即消费方；单页
视觉调整留在应用层。主题行为至少覆盖手动模式持久化、系统偏好变化、无效存储值和无 Provider 的
静态渲染；应用验收还要覆盖领域界面在主题切换后的同步状态。Campus 的 `@ui-baseline` lane 只匹配
代表性 spec，Ops 浏览器配置固定 `320/390/1440` 三个项目，避免把全量页面测试无意间倍增。
