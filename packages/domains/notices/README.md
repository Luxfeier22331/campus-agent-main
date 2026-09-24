# 通知领域包

`packages/domains/notices` 拥有通知正文规范化、分类体系、来源资源声明和门户时间解析的
运行时中立实现。字段级 wire 常量（分类值、允许标签和属性）由 `campus-contracts/notices`
登记，本包在其上实现领域逻辑：

- `content.ts`：门户原始 HTML 清洗为结构化正文（标题去重、层级规范化、表格、图片和排版）；
- `taxonomy.ts`：分类描述、过滤分组和分类体系维护；
- `source-resources.ts`：正文图片与附件资源的来源对象声明；
- `time.ts`：门户发布时间解析；
- `browser.ts` 与 `content.css`：浏览器端正文渲染的允许清单约束。

消费者包括 campus-web 正文渲染、ops-web 通知预览、notice-publisher 正文清洗和
`scripts/notices` 评测。本包不读取数据库或对象存储，也不承担采集、分类和发布流程。

```bash
pnpm --dir packages/domains/notices typecheck
pnpm test --filter=@campus-agent/notices
```
