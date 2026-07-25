# @campus-agent/ui

仓库内 Web 界面共享的语义 Token 和无业务语义控件。应用从包根导入 React primitive，并在全局
样式中依次导入 `tokens.css` 和 `theme.css`。

本包不拥有路由、页面布局、产品文案、业务状态、查询逻辑、DataTable 或领域可视化。状态到中文
文案和 tone 的映射必须留在消费应用中。

```bash
pnpm --dir packages/ui typecheck
pnpm --dir packages/ui test
```
