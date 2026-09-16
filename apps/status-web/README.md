# status-web

面向公众的产品可用性状态页 Cloudflare Worker。公共浏览器只读取本 Worker 发布的快照；定时入口通过
获准的第一方 HTTP 信号更新快照，不读取产品数据库、Langfuse 或 Ops Web。

## 职责

- 提供公共状态页和同源只读快照；
- 黑盒探测校园问答与其他学生产品服务；
- 保存当前状态和有限历史时间线；
- 提供固定的 Campus 产品导航重定向。

浏览器入口 `/status-page.js` 是稳定 facade；快照校验与日期模型、HTTP client、DOM renderer 和页面
生命周期分别位于 `public/status-model.js`、`status-client.js`、`status-renderer.js` 与
`status-page-controller.js`。HTML 不直接依赖这些内部模块路径。

产品行为见 `docs/product/status-web.md`，快照字段以
`packages/contracts/schemas/product-availability-snapshot.v1.schema.json` 为准。环境地址、KV、
Cron、域名和 Worker 变量由 Wrangler 配置、发布适配器和环境仓维护。

## 本地验证

```bash
pnpm --dir apps/status-web typecheck
pnpm --dir apps/status-web test:node
pnpm --dir apps/status-web test:worker
pnpm --dir apps/status-web build:worker
pnpm --dir apps/status-web test:browser
```

浏览器测试验证响应式、键盘、主题、forced-colors 和 reduced-motion 行为，但不证明任一环境已经部署。

## 相关文档

- `docs/product/status-web.md`
- `docs/architecture/system/product-runtime.md`
- `.agents/notes/implemented/feature/2026-08-11-adr-0086-product-availability-status.md`
- `docs/reference/verification.md`
