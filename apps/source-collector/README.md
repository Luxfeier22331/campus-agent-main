# source-collector

来源采集的 Temporal Activity Worker。

## 职责

本应用执行任务注册表中分配给 `source_collector` 的来源任务。适配器读取对象存储中的请求，调用
来源系统，写入来源产物和结果清单，并把有界结果返回 Temporal。

当前适配器覆盖 Official Web、内部门户通知、内部门户文件发布和微信公众号。Crawlee、
Playwright、浏览器状态、供应商客户端及供应商凭据留在本应用内。

本应用不启动 workflow、不维护 PostgreSQL 任务状态、不发布查询目标，也不通过 app-api 提供
采集接口。重试、超时和取消由 Temporal 管理；取消必须传递到来源请求、浏览器和对象存储写入。

内部门户认证 activity 只建立新门户会话并探测登录状态，不执行通知采集或保存凭据到 Temporal
载荷。凭据更新与状态检查步骤见认证操作手册。

## 入口

```bash
pnpm --filter source-collector start:temporal-worker
pnpm --filter source-collector auth:check:notice
pnpm --filter source-collector auth:check:file-release
pnpm --filter source-collector auth:save
pnpm --filter source-collector auth:refresh
```

生产镜像只包含 activity 所需的 Playwright Chromium。具体对象存储和供应商配置由部署环境注入。

## 验证

```bash
pnpm --filter source-collector typecheck
pnpm --filter source-collector test:ingest
```

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/domains/official-web.md`
- `docs/data/internal-portal.md`
- `docs/runbooks/portal-auth.md`
