---
doc_type: product_requirement
owner_boundary: apps/campus-web
status: active
---

# Campus Web 设计规范

## 文档边界

本文冻结 `campus-web` 学生端与其 `/docs/*` Rspress 阅读面的跨页面体验要求。

它负责：

- 学生端共同遵循的产品体验原则
- 视觉语义、布局类型和组件所有权
- 导航、异步状态、响应式、无障碍、动效、内容和性能要求
- 可复用 UI 进入共享层的条件
- UI 变更的完成标准

它不负责：

- Dining、地图、问答、文档阅读器或账号链路的领域行为
- HTTP、数据、认证或 runtime contract
- Ops Web 或运营后台体验
- 像素级页面稿、组件目录站或设计工具工作流

领域文档可以增加领域约束，但不得降低本文的跨页面可用性、无障碍和性能要求。

## 规范词

本文中的“必须（MUST）”“不得（MUST NOT）”“应（SHOULD）”和“可以（MAY）”按
RFC 2119 / RFC 8174 的要求强度理解。

## 产品体验原则

### 任务优先

- 第一屏必须直接承载用户当前任务，不使用营销式 hero、功能介绍卡或教学文案占据主体验。
- 页面应优先呈现用户要查、要读、要选择或要提交的内容，再渐进展示次要信息。
- 用户不需要理解 API、schema、projection、provider、release 或内部 owner 才能完成任务。

### 轻量而明确

- 页面必须保持清晰的信息层级和稳定布局，避免卡片堆叠、重阴影、过度圆角和无意义装饰。
- 一个视图只应有一个主要交互重点；次要操作不得与主要操作争夺视觉权重。
- 动态变化必须解释当前状态和下一步，不得通过静默消失或空白界面表达失败。

### 跨入口连续

- 问答、文档、校园地图、食堂、反馈和账号属于同一个产品。
- 导航标签、顺序、active 语义、账号入口和返回目标必须一致。
- 各入口可以按任务采用不同布局，但不能各自发明另一套导航、颜色语义或控件行为。

### 移动端完整

- 移动端不是桌面页面的裁剪版。核心浏览、选择、提交、重试、关闭和返回必须完整可用。
- 页面必须支持 `320px` CSS viewport 下的重排，不得依赖横向页面滚动完成核心任务。
- 主要触控操作和图标按钮应提供至少 `44px` 的触控区域。

### 状态透明

- 系统必须区分 loading、empty、error、degraded、success 和 disabled，不得把读取失败展示为空数据。
- 局部依赖失败时，应保留仍然可用的主体验，并把错误放在受影响区域附近。
- 错误必须说明发生了什么，并在可恢复时提供一个明确的下一步。

### 感知性能优先

- 首屏不得因可并行请求、重复 session 读取或非关键依赖形成瀑布。
- 异步内容必须预留稳定空间，避免 loading、内容和错误状态之间发生明显布局跳动。
- 已获得的集合项应尽早展示，不得为了等待非关键内容阻塞整个页面。

## 事实源与所有权

跨页面设计事实按以下顺序落盘：

1. 本文定义用户可感知行为和完成标准。
2. `apps/campus-web/src/design/tokens.css` 定义基础值、语义 Token、共享组件 Token 和领域可视化 Token。
3. `apps/campus-web/src/components/ui/` 定义跨页面 primitive 和共享交互行为。
4. `apps/campus-web/src/styles.css` 与 `apps/campus-web/theme/docs-ui.css` 只负责技术栈适配。
5. 领域组件和领域文档定义地图、Dining、问答、文档阅读和账号特有行为。

组件所有权固定为：

- assistant-ui 负责问答 thread、composer、message、tool 和 conversation history primitive。
- Better Auth UI 与 HeroUI 负责账号、认证和账号弹层；HeroUI 不作为普通产品页面的通用组件来源。
- Rspress 负责 `/docs/*` 阅读器结构、目录、文档搜索和正文排版。
- repo-owned shadcn/Radix wrapper 负责普通按钮、输入、选择、菜单、弹层、提示和共享状态。
- 简单、单场景的数据展示优先使用语义 HTML，不为一次使用创建通用组件。

## Token 与视觉语言

Token 层级固定为：

```text
品牌/基础值 -> 语义 Token -> 共享组件 Token -> 领域可视化 Token
```

要求：

- 普通页面和共享组件必须消费语义或共享组件 Token，不得直接使用品牌色或任意十六进制颜色。
- 第三方 UI 主题必须限定在所属适配器表面，不得覆盖普通产品页面的全局 Token 或通用 utility 语义。
- 品牌红用于身份表达或危险语义，交互主色使用交互蓝，成功和餐饮地图语义可以使用绿色。
- 地图底图、Dining SVG 和媒体内容可以保留领域颜色，但不得反向定义普通控件颜色。
- 默认产品主题为 light。未提供入口、完整 Token 和验收前，不得保留或声明 dark theme 支持。
- 卡片和普通面板圆角不得超过 `8px`；对话框、sheet 和地图浮层可以使用适合其交互语境的形状。
- 普通页面使用轻边框和极轻阴影；不得用阴影代替信息层级。
- 不使用渐变、发光、装饰性模糊色块或嵌套卡片营造层次。

## 布局与排版

页面按任务选择一种布局：

- `reading`：问答正文和文档正文，限制行长，优先连续阅读。
- `form`：反馈、账号、法律和单任务表单，最大宽度 `896px`。
- `workspace`：Dining、班车等扫描和比较界面，最大宽度 `1280px`。
- `immersive`：校园地图等全屏交互面，不套装饰性页面卡片。

要求：

- 支撑页 header 与页面主体必须使用同一 workspace 对齐线。
- 页面标题移动端使用 `text-2xl`、桌面使用 `text-3xl`；面板标题不得使用 hero 字号。
- 正文、标签和状态文案必须允许换行；动态内容不得挤压或覆盖相邻控件。
- 字号不得随 viewport 连续缩放，字距保持 `0`，正文保持可读行长。
- 固定格式元素必须通过稳定尺寸、grid track、aspect ratio 或 min/max 约束避免布局漂移。

## 导航

- 产品导航项及其顺序只有一个事实源。
- 标准页、问答、地图和 Rspress 可以使用不同容器样式，但必须共享标签、目标、active 规则和键盘语义。
- 地图导航可以使用适合动态地图背景的半透明浮层；这不构成第二套产品导航。
- 移动端导航必须可由键盘和触控打开、选择和关闭，关闭后焦点返回触发按钮。
- 账号入口可以延迟读取 session，但占位必须保留稳定尺寸，不能引起导航跳动。

## 组件与状态

共享组件晋升条件：

- 两个独立产品页面已经使用同一种行为；或
- 该行为涉及焦点、键盘、弹层、状态播报等需要单一无障碍实现的复杂交互。

不满足条件的组件留在领域目录。不得为假设中的复用创建 package、factory 或组件目录站。

状态使用规则：

- route 或大区域读取使用保持最终布局形状的 skeleton。
- 区域级 loading、empty、error、info 和 success 使用 `SurfaceState` 或领域等价状态。
- 表单字段错误紧邻字段，表单提交结果使用 Alert 与 `aria-live`。
- secondary dependency 失败使用局部 degraded state，不得覆盖主体验。
- empty state 只表示成功读取后的空集合，且应在存在合理动作时提供一个下一步。

## 无障碍与输入

- 目标基线为 WCAG 2.2 A/AA。
- 所有交互必须有可访问名称、正确 role/state/value、可见焦点和逻辑焦点顺序。
- 所有核心任务必须可只用键盘完成，不得产生 keyboard trap。
- 对话框和菜单关闭后必须恢复焦点；动态结果和异步状态必须适度播报，避免重复 announcement。
- 颜色不得是状态或选择的唯一表达；图标按钮必须提供可访问名称。
- 内容必须支持 `320px` reflow、文本放大和 reduced motion。
- 使用可访问 primitive 不能替代完整页面和完整用户旅途测试。

## 动效

- 动效必须帮助理解状态、空间关系或反馈；纯装饰动效不得加入产品界面。
- 共享交互动效使用 `apps/campus-web/src/components/ui/motion.tsx`，默认时长为 `180ms`。
- 只动画 `transform` 和 `opacity`；不得通过 height、width、top 或 left 动画制造布局抖动。
- 必须尊重 `prefers-reduced-motion`，并避免在 loading 状态同时展示多个高关注动画。

## 内容规范

- 默认使用直接、具体的中文。英文只用于正式名称、代码或无法合理翻译的术语。
- 标题描述对象或任务，辅助文案说明用户当前需要知道的信息，不解释页面实现了什么功能。
- 不向普通用户展示 release ID、request ID、schema version、source record、provider 或内部 owner。
- 时间可以显示为“更新于”或“生效于”；版本只在用户需要比较或判断有效性时展示。
- 错误文案不归咎用户，不使用“未知错误”，并在可以恢复时提供重试、返回或反馈入口。
- 成功文案确认结果即可；内部回执只有在用户后续能够引用或查询时才展示。

## 性能要求

- `campus-web` 路由 gzip bundle budget 继续作为构建门禁，不得为视觉改动放宽。
- 生产 Web Vitals 以第 75 百分位衡量，目标为 `LCP <= 2.5s`、`INP <= 200ms`、`CLS <= 0.1`。
- FCP 与 TTFB 作为诊断指标，不单独定义产品通过结论。
- route chunk、非关键账号状态、重型地图 runtime 和评价内容应按用户意图加载或预取。
- loading UI 不得掩盖可以直接消除的请求瀑布或昂贵同步渲染。

## UI 完成标准

用户可见变更在合入前必须满足：

- 使用既有 owner、Token 和 primitive，没有引入第二套通用组件体系。
- desktop、tablet、mobile 和 `320px` reflow 下无文本遮挡、失控横向滚动或不可达操作。
- loading、empty、error、degraded 和 success 与数据事实一致。
- 键盘、焦点恢复、可访问名称、状态播报和 reduced motion 已验证。
- 自动化 WCAG A/AA 检查没有未解释 violation；自动化无法覆盖的完整旅途完成浏览器检查。
- route bundle budget、类型检查、组件测试和 `test:e2e:smoke` 通过；跨页面体验重构还需在本地
  运行 `test:e2e:full`。
- 领域行为仍由领域 contract 决定，没有通过视觉重构改变业务语义。

## 明确不做

- 不建立独立设计文档目录。
- 不拆出独立设计系统 package。
- 不引入第二套通用 UI framework。
- 不以 Storybook、Chromatic、Figma 同步或截图基线作为当前治理前提。
- 不要求领域地图、SVG、正文内容和普通控件使用同一套像素值。

## 外部依据

- [GitHub Primer Product UI](https://primer.style/product/)
- [Primer loading pattern](https://primer.style/product/ui-patterns/loading)
- [Primer degraded experiences](https://primer.style/product/ui-patterns/degraded-experiences)
- [GitLab Pajamas design-system philosophy](https://design.gitlab.com/get-started/design-system-philosophy)
- [GitLab Pajamas contribution lifecycle](https://design.gitlab.com/get-started/lifecycle)
- [GOV.UK Design System](https://design-system.service.gov.uk/)
- [GOV.UK contribution criteria](https://design-system.service.gov.uk/community/contribution-criteria/)
- [Carbon Design System](https://carbondesignsystem.com/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
