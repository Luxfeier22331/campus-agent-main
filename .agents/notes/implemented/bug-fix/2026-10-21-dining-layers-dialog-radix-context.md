# Agent Note: 食堂图层对话框的 Radix context 边界

Status: implemented

## 背景

食堂地图编辑器在窄视口没有桌面端的“地图元素”侧栏，只能点“图层与元素”按钮打开 tldraw 对话框。该对话框
由自定义 `Dialogs` 组件（`DiningDialogs`/`DiningDialog`）渲染，它直接使用项目依赖的
`@radix-ui/react-dialog`；而对话框内容沿用了 tldraw 的 `TldrawUiDialogTitle` 和
`TldrawUiDialogCloseButton`，这两个原语走的是 tldraw 自己依赖的 `radix-ui` 实例。两个包各自维护
Dialog context，互不相通，因此打开对话框时抛出 `DialogTitle must be used within Dialog`，错误边界把
整个画布替换成“地图编辑器暂时无法继续”。桌面端测试从未点到这个按钮，缺陷一直未暴露。

## 决策

`DiningLayersDialog` 内的标题和关闭按钮改用 `@radix-ui/react-dialog` 的 `Title`/`Close`，与
`DiningDialog` 的 `Root` 保持同一 context；关闭按钮沿用 tldraw 的类名和触屏点击处理，外观与交互不变。
`DiningDialog` 继续负责整页固定定位和 z-index，不切换到 tldraw 默认的 `DefaultDialogs`。

## 未采用方案

- 改用 tldraw 默认 `DefaultDialogs`：context 一致，但它把对话框绝对定位在编辑器容器内，丢失当前整页
  固定覆盖和 z-index 40 的行为。
- 在 ops-web 声明 `radix-ui` 依赖并让 `DiningDialog` 改用该包：可以让 Root 与 tldraw 原语共享实例，
  但需要依赖 pnpm 把两处解析到同一物理包；只要版本解析分叉，缺陷会以同样方式复发，且新增一个大依赖。
- 只调整测试选择器：对话框仍然打不开，窄视口无法查看图层与元素，问题被掩盖。

## 后果

通过 `DiningDialogs` 渲染的对话框内容必须使用 `@radix-ui/react-dialog` 的原语，不能混用 tldraw 基于
另一份 `radix-ui` 的对话框原语。tldraw 原语中的方向、翻译等能力在食堂对话框里不再自动生效；当前界面为
中文且无 RTL 需求，关闭按钮文案直接固定。桌面端侧栏与窄视口对话框共用 `DiningElementList`，行为一致。
