---
doc_type: decision
decision_id: ADR-0011
status: accepted
created: 2026-03-27
updated: 2026-03-27
---

# ADR-0011 Protected Panel Worker Runtime 决策

适用范围：`apps/protected-internal-panel` 的正式 runtime 宿主、UI shell 方向与长期 operator control plane 形态

## 背景

protected internal panel 已经被长期文档冻结为：

- 独立 protected surface
- non-public by default / fail-closed
- controlled operator access，而不是终端用户账户产品
- `runtime APIs only`

在上述边界已经冻结后，panel 仍需正式收口两个长期问题：

- `apps/protected-internal-panel` 应采用什么 runtime 宿主
- panel 应优先完全自建 UI，还是优先基于成熟开源 admin framework 改造

## 决策 1：panel runtime 冻结为 `Cloudflare Workers`

结论：

- `apps/protected-internal-panel` 的正式 runtime 宿主冻结为 `Cloudflare Workers`
- protected panel 的 runtime origin 以 Worker shell 形态存在

原因：

- panel 的长期 exposure model 已经依赖 Cloudflare Access 作为 outer protection envelope
- panel 面向少量 operator，属于受保护运行控制面，而不是重型在线事务后端
- Worker runtime 更符合“受保护 UI + origin admission + panel BFF”的长期形态
- 这条路线不要求 panel 回退到自建 Docker origin 才能成立

## 决策 2：panel 不是全仓库 runtime 冻结

结论：

- 这里冻结的是 `apps/protected-internal-panel` 这条 runtime boundary
- 不是把整个 monorepo 的 runtime 一次性统一冻结到 Workers

原因：

- `apps/supervisor-api`、ingestion、specialist 与其他 app boundary 仍有各自 runtime shape
- panel runtime freeze 不应反向扩大成仓库级单一 runtime 承诺

## 决策 3：UI shell 优先采用开源 admin framework 改造

结论：

- panel UI shell 优先采用成熟开源 admin framework 改造，而不是从零自建通用后台框架
- 当前首选方向是 `react-admin`

原因：

- panel 的主要目标是 operator control plane，而不是高度定制的终端产品前台
- `react-admin` 更适合资源列表、详情、过滤、审计视图与少量受控操作
- 这条路线可以减少重复造轮子，同时不改变 panel 的 protected runtime / API seam

补充说明：

- 允许在 `react-admin` 之上增加 custom pages 以承载非 CRUD 的 operator flows
- UI framework 不能反向定义 auth model、runtime seam 或 package boundary

## 决策 4：panel 的长期功能域固定为 control plane，而不是通用后台

结论：

panel 长期功能域固定为：

- `Overview`
- `Requests`
- `Jobs`
- `Operations`
- `Audit`

这些能力域表达的是：

- 运行可见性
- 请求级排障入口
- 后台任务观察
- 少量可审计的 operator 动作
- operator 行为与系统动作审计

## 明确不做

- 不做完整用户系统
- 不做 CMS
- 不做数据库控制台
- 不做对象存储/索引控制台
- 不做任意 shell / SQL / 内部 API 代理
- 不把 panel 做成 `apps/supervisor-api` hidden admin mode
- 不为 panel 打开 `packages/*` 直连路径

## 后果

直接结果：

- `apps/protected-internal-panel` 后续实现应以 Worker shell 为目标，而不是延续任何占位 runtime
- panel 文档、README 与 implementation handoff 应围绕 Worker origin、Access assertion validation 和 panel BFF 收口
- panel 功能规划应优先围绕五个能力域展开，而不是扩张成通用业务后台

明确不做：

- 不因为 Worker runtime freeze 就修改其他 app boundary 的 runtime 承诺
- 不因为选择开源 admin framework 就放弃 panel 的长期安全边界

## 相关文档

- `docs/architecture/protected-internal-panel-boundary.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/architecture/protected-panel-operator-access.md`
- `docs/architecture/cloudflare-runtime-topology.md`
