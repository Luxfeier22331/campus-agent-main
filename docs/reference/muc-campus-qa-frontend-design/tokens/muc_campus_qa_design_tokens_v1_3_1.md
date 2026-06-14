---
doc_type: reference
truth_scope: product
owner_boundary: apps/campus-web
status: active
created: 2026-06-08
updated: 2026-06-08
---
# MUC Campus Q&A Design Tokens v1.3.1

这是 v1.3 的 token patch，重点补齐 **component state** 和 **mobile layout**，避免实现时在组件里临时硬编码。

## 这版新增内容

### 1. 系统化 state token

新增 `sys.state`：

- `hover`
- `pressed`
- `active`
- `selected`
- `focus`
- `disabled`
- `error`
- `success`
- `warning`
- `loading`

实现时应优先引用这些 token，再映射到组件状态。例如：

```css
.input:focus {
  border-color: var(--state-focus-border);
  box-shadow: var(--state-focus-shadow);
}

.input[aria-invalid="true"] {
  border-color: var(--state-error-border);
  background: var(--state-error-bg);
}

.button:disabled {
  color: var(--state-disabled-text);
  background: var(--state-disabled-bg);
  cursor: var(--state-disabled-cursor);
}
```

### 2. Component state token

新增或补全以下组件状态：

- `comp.button.state.primary / secondary / ghost`
- `comp.input.state`
- `comp.card.state`
- `comp.chat.historyItem.state`
- `comp.chat.composer.state`
- `comp.chat.message.state`
- `comp.chat.attachment.state`
- `comp.docs.navItem.state`
- `comp.map.markerState`
- `comp.map.popoverState`
- `comp.dining.stallState`
- `comp.dining.priceList.row.state`
- `comp.feedback.field.state`

约束：组件里不要再写 `#eee`、`rgba(...)`、`opacity: .5` 这类临时状态值。

### 3. Mobile token

新增 `sys.layout.mobile` 和 `comp.mobile`，覆盖当前移动端设计里的实际结构：

- safe area：`top / right / bottom / left`
- 页面 padding：`pagePaddingX / pagePaddingY`
- 卡片间距：`cardGap / cardPadding`
- 触控最小尺寸：`touchTargetMin`
- 移动端 topbar / bottom nav 高度
- 底部固定输入区：高度、padding、safe area bottom
- composer：min/max height、input height、send button size
- bottom sheet：min/max height、handle size、shadow
- 移动端地图 / 饭堂 SVG 最小高度

示例：

```css
.mobile-composer-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  min-height: var(--mobile-fixed-input-area-height);
  padding: var(--mobile-fixed-input-area-padding-top)
           var(--mobile-fixed-input-area-padding-x)
           var(--mobile-fixed-input-area-padding-bottom);
  background: var(--mobile-fixed-input-area-bg);
  border-top: 1px solid var(--mobile-fixed-input-area-border);
  box-shadow: var(--mobile-fixed-input-area-shadow);
}
```

## 色彩使用边界

仍沿用 v1.3 的原则：

- 民大红只用于学校身份识别和极少量关键强调。
- 民大藻井蓝用于 Web 交互、focus、link、selected。
- error 使用民大红，但只用于错误状态，不作为普通强调色。
- success 使用油松绿，warning 使用银杏黄。
- 饭堂分布图不展示实时状态；名称与价格列表固定放在 SVG 下方。

## 文件

- `muc_campus_qa_design_tokens_v1_3_1.json`：DTCG 风格完整 token。
- `muc_campus_qa_design_tokens_v1_3_1.css`：运行时 CSS variables。
- `muc_campus_qa_tailwind_theme_v1_3_1.js`：Tailwind 映射示例。
