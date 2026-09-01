# @campus-agent/ui

仓库内 Web 界面共享的语义 Token 和无业务语义控件。应用从包根导入 React primitive，并在全局
样式中依次导入 `tokens.css` 和 `theme.css`。

本包不拥有路由、页面布局、产品文案、业务状态、查询逻辑、DataTable 或领域可视化。状态到中文
文案和 tone 的映射必须留在消费应用中。

只有控件已经被两个应用消费，或第二个消费者在同一变更中落地时，才进入共享包。单个页面或
应用专属的组件、样式和交互继续由消费应用维护，不为假设性复用提前抽取。

## 主题

应用入口用 `ThemeProvider` 包住页面，并在入口 HTML 引用 `theme-bootstrap.js`。控件通过
`ThemeModeControl` 提供“跟随系统”“浅色”“深色”三种选择；默认跟随系统，手动选择只保存外观
偏好，不保存业务数据。无 Provider 时 `useTheme` 使用可静态渲染的 system 默认值，便于文档预渲染和
独立组件测试。桌面紧凑导航入口使用 `ThemeModeMenu`；已有可见外观设置区域使用完整的
`ThemeModeControl`。

当浏览器支持 View Transition 且用户未要求减少动态效果时，实际明暗变化会通过根快照短暂淡入淡出；
首次同步、实际主题未变化和不支持该能力的浏览器立即更新。Provider 会中止仍在进行的旧 View Transition，
因此连续选择只呈现最后一次外观。应用不应再给页面全部元素添加颜色 transition；MapLibre、tldraw
等自绘领域界面仍在各自集成边界协调内部主题。

```tsx
import { ThemeModeControl, ThemeProvider } from "@campus-agent/ui";

export function AppEntry() {
  return (
    <ThemeProvider>
      <header>
        <ThemeModeControl />
      </header>
      {/* application routes */}
    </ThemeProvider>
  );
}
```

当页面已经有可见的“外观”标题时，使用 `label={null}` 并通过 `aria-labelledby` 关联，避免重复
声明辅助标签：

```tsx
<p id="settings-theme-label">外观</p>
<ThemeModeControl aria-labelledby="settings-theme-label" label={null} />
```

全局 CSS 的导入顺序必须保持为 `tokens.css` 后接 `theme.css`，应用 Token 只能在两者之后扩展。
应用可以用自己的 Token 和应用级 `@theme inline` 重映射通用工具类，但不得声明或覆盖同名
`--sys-*` 变量，也不得改变其他应用的编译结果。共享包不提供业务 profile；`data-ui-profile` 由
应用根布局声明。

`theme.css` 同时提供共享浮层和折叠控件使用的动画工具类；消费方不得依赖其他 UI 包的传递依赖
来获得这些样式。

共享颜色按职责消费：品牌身份色只表达学校身份，实色交互 tint 用于主操作和明确控件开态，链接使用
独立文字语义，导航、Tabs、筛选和列表当前项使用选中表面、文字与边框，业务状态使用各自的
`info`、`success`、`warning`、`danger` 语义。消费方不得用主操作色模拟选中或状态，也不得把颜色
作为状态或图表系列的唯一提示。

```bash
pnpm --dir packages/ui typecheck
pnpm --dir packages/ui test
```
